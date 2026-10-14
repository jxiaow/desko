// A legacy entry can contain several rollouts behind one manifest. Restore the
// complete group and keep its manifest until every file has been published.
fn session_restore_plan(entry: &TrashedSessionEntry) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    let relative = Path::new(&entry.manifest.relative_rollout_path);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err("回收站会话相对路径无效，已保留全部文件".into());
    }
    let mut source_root = entry.manifest.original_rollout_path.clone();
    for _ in relative.components() {
        source_root.pop();
    }
    if source_root.join(relative) != entry.manifest.original_rollout_path
        || !source_root.starts_with(&entry.manifest.instance_root)
    {
        return Err("回收站会话原路径与清单不一致，已保留全部文件".into());
    }
    let files_root = entry.entry_dir.join("files");
    let batch = entry.entry_dir.parent().ok_or("回收站条目路径无效")?;
    let trash_root = batch.parent().ok_or("回收站批次路径无效")?;
    for directory in [trash_root, batch, entry.entry_dir.as_path()] {
        let metadata = fs::symlink_metadata(directory).map_err(|error| error.to_string())?;
        if session_restore_link(&metadata) || !metadata.is_dir() {
            return Err("回收站目录是链接或不是文件夹，已保留全部文件".into());
        }
    }
    let canonical_entry = fs::canonicalize(&entry.entry_dir).map_err(|error| error.to_string())?;
    let canonical_files = fs::canonicalize(&files_root).map_err(|error| error.to_string())?;
    if session_restore_link(&fs::symlink_metadata(&files_root).map_err(|error| error.to_string())?)
        || canonical_files != canonical_entry.join("files")
    {
        return Err("回收站文件目录是链接，已保留全部文件".into());
    }
    let files = list_trash_restore_files(&files_root)?;
    if files.is_empty() {
        return Err("回收站中的会话文件不存在，无法恢复".into());
    }
    let multiple = files.len() > 1;
    let mut plan = Vec::new();
    for source in files {
        let file_relative = source
            .strip_prefix(&files_root)
            .map_err(|_| "回收站文件路径无效")?;
        let canonical_source = fs::canonicalize(&source).map_err(|error| error.to_string())?;
        if !canonical_source.starts_with(&canonical_files) {
            return Err("回收站文件指向目录外，已保留全部文件".into());
        }
        let id = rollout_session_id(&source)?;
        if id
            .as_ref()
            .is_some_and(|id| id != &entry.manifest.session_id)
            || ((multiple || file_relative != relative) && id.is_none())
        {
            return Err("回收站中的会话文件与清单不一致，已保留全部文件".into());
        }
        let target = source_root.join(file_relative);
        let target_relative = target
            .strip_prefix(&entry.manifest.instance_root)
            .map_err(|_| "会话恢复路径不在实例目录内")?;
        if target_relative
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
        {
            return Err("会话恢复路径无效，已保留全部文件".into());
        }
        // Check the nearest existing parent before creating directories. A
        // junction or symlink must not redirect recovery outside this instance.
        let mut trusted_parent = entry.manifest.instance_root.as_path();
        while !trusted_parent.exists() {
            trusted_parent = trusted_parent.parent().ok_or("会话实例路径无效")?;
        }
        let expected_instance = fs::canonicalize(trusted_parent)
            .map_err(|error| error.to_string())?
            .join(
                entry
                    .manifest
                    .instance_root
                    .strip_prefix(trusted_parent)
                    .map_err(|_| "会话实例路径无效")?,
            );
        let mut parent = target.parent().ok_or("会话恢复路径无效")?;
        while !parent.exists() {
            parent = parent.parent().ok_or("会话恢复路径无效")?;
        }
        let canonical_target = fs::canonicalize(parent)
            .map_err(|error| error.to_string())?
            .join(
                target
                    .strip_prefix(parent)
                    .map_err(|_| "会话恢复路径无效")?,
            );
        if !canonical_target.starts_with(&expected_instance) {
            return Err("会话恢复目录指向实例外，已保留全部文件".into());
        }
        if fs::symlink_metadata(&target).is_ok() {
            return Err(format!(
                "目标位置已有会话文件，回收站副本已保留，未覆盖: {}",
                target.display()
            ));
        }
        plan.push((source, target));
    }
    Ok(plan)
}

fn rollback_session_moves(moved: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    let mut failures = Vec::new();
    for (source, target) in moved.iter().rev() {
        if let Err(error) = move_rollout_without_replacing(target, source) {
            failures.push(format!(
                "已保留恢复位置的完整会话 ({}): {error}",
                target.display()
            ));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("；"))
    }
}

fn remove_empty_session_dirs(path: &Path) -> std::io::Result<()> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata.is_dir() && !session_restore_link(&metadata) {
            remove_empty_session_dirs(&entry.path())?;
        }
    }
    if fs::read_dir(path)?.next().is_none() {
        fs::remove_dir(path)?;
    }
    Ok(())
}

fn session_restore_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

fn list_trash_restore_files(path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if session_restore_link(&metadata) {
            return Err("回收站内包含文件链接，已保留全部文件".into());
        }
        if metadata.is_dir() {
            files.extend(list_trash_restore_files(&entry.path())?);
        } else if metadata.is_file() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("rollout-") && name.ends_with(".jsonl") {
                files.push(entry.path());
            }
        }
    }
    files.sort();
    Ok(files)
}

fn restore_trashed_session_entry(entry: &TrashedSessionEntry) -> Result<(), String> {
    let plan = session_restore_plan(entry)?;
    let index = read_session_index_map(&entry.manifest.instance_root)?;
    let mut moved = Vec::new();
    let result = (|| {
        for (source, target) in &plan {
            fs::create_dir_all(target.parent().ok_or("会话恢复路径无效")?)
                .map_err(|error| format!("创建会话恢复目录失败: {error}"))?;
            move_rollout_without_replacing(source, target)
                .map_err(|error| format!("无法安全恢复会话，已保留副本（请关闭占用程序，并确保目标位于同一磁盘）: {error}"))?;
            moved.push((source.clone(), target.clone()));
        }
        let newest = plan
            .iter()
            .map(|(_, target)| target)
            .max_by_key(|target| {
                rollout_file_activity_seconds(target)
                    .or_else(|| rollout_file_modified_seconds(target))
            })
            .ok_or("回收站中没有可恢复文件")?;
        let mut index_entry = build_restored_session_index_entry(entry, newest);
        if let Some(JsonValue::Object(existing)) = index.get(&entry.manifest.session_id) {
            for (key, value) in existing {
                index_entry
                    .as_object_mut()
                    .ok_or("会话索引条目无效")?
                    .entry(key.clone())
                    .or_insert_with(|| value.clone());
            }
        }
        append_restored_session_index_entry(&entry.manifest.instance_root, &index_entry)
    })();
    if let Err(error) = result {
        if let Err(rollback) = rollback_session_moves(&moved) {
            return Err(format!("{error}；文件回移失败：{rollback}"));
        }
        return Err(error);
    }
    // Remove only empty directories. Never recursively delete unrecognized
    // files or another recovery copy added to a legacy entry.
    let cleanup = (|| -> std::io::Result<()> {
        let files_root = entry.entry_dir.join("files");
        remove_empty_session_dirs(&files_root)?;
        if !files_root.exists() {
            fs::remove_file(entry.entry_dir.join("manifest.json"))?;
            if fs::read_dir(&entry.entry_dir)?.next().is_none() {
                fs::remove_dir(&entry.entry_dir)?;
                cleanup_empty_trash_ancestors(&entry.entry_dir);
            }
        }
        Ok(())
    })();
    if let Err(error) = cleanup {
        modules::logger::log_warn(&format!("会话已恢复，但清理回收站条目失败: {error}"));
    }
    Ok(())
}

fn append_restored_session_index_entry(root: &Path, entry: &JsonValue) -> Result<(), String> {
    let serialized = serde_json::to_string(entry).map_err(|error| error.to_string())?;
    let path = root.join(SESSION_INDEX_FILE);
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("打开会话索引失败: {error}"))?;
    // Codex appends to this file too. Its readers already use the last record
    // per ID, so appending preserves concurrent new sessions and malformed lines.
    file.write_all(format!("\n{serialized}\n").as_bytes())
        .map_err(|error| format!("追加会话索引失败: {error}"))?;
    // A flush failure may leave a complete record. Do not truncate: Codex can
    // append concurrently. The caller preserves the rollouts by moving them back.
    file.sync_all()
        .map_err(|error| format!("会话索引写入结果尚未确认，请重新读取列表后重试: {error}"))
}
