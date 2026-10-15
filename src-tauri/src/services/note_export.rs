use std::{collections::HashSet, fs::{File, OpenOptions}, io::Write, path::{Path, PathBuf}};
use serde::Deserialize;

#[derive(Clone, Copy, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat { Markdown, Html, Word, Pdf }

#[derive(Deserialize, Debug)]
pub struct ExportFile { pub name: String, pub content: String }

pub fn validate_files(format: ExportFormat, files: &[ExportFile]) -> Result<(), String> {
    if files.is_empty() || files.len() > 10_000 { return Err("请选择 1 至 10000 条小记导出".into()); }
    if files.iter().map(|file| file.content.len()).sum::<usize>() > 64 * 1024 * 1024 {
        return Err("导出内容超过 64 MB，请分批导出".into());
    }
    if format == ExportFormat::Pdf && files.len() != 1 { return Err("PDF 必须合并为一份文档".into()); }
    let extension = match format { ExportFormat::Markdown => ".md", ExportFormat::Html => ".html", ExportFormat::Word => ".doc", ExportFormat::Pdf => ".pdf" };
    let mut names = HashSet::new();
    for file in files {
        let name = &file.name;
        if name.is_empty() || name.chars().any(|c| c.is_control() || "/\\<>:\"|?*".contains(c))
            || name.ends_with(['.', ' ']) || !name.to_lowercase().ends_with(extension)
            || !names.insert(name.to_lowercase()) {
            return Err("导出文件名无效或重复".into());
        }
    }
    Ok(())
}

/// 先写同目录临时文件；成功后再替换目标，失败不会破坏已有导出。
pub struct PendingExport(pub PathBuf);
impl PendingExport {
    pub fn create(destination: &Path) -> Result<(Self, File), String> {
        let parent = destination.parent().ok_or("请选择有效的保存路径")?;
        let path = parent.join(format!(".desko-export-{}.pdf", uuid::Uuid::new_v4()));
        let file = OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| format!("无法创建导出文件：{e}"))?;
        Ok((Self(path), file))
    }
    pub fn commit(self, destination: &Path) -> Result<(), String> {
        std::fs::rename(&self.0, destination).map_err(|e| format!("无法保存导出文件：{e}"))
    }
}
impl Drop for PendingExport {
    fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
}

pub fn write_documents(mut target: File, files: &[ExportFile]) -> Result<(), String> {
    let write = || -> Result<(), Box<dyn std::error::Error>> {
        if files.len() == 1 {
            target.write_all(files[0].content.as_bytes())?;
            target.sync_all()?;
        } else {
            let mut zip = zip::ZipWriter::new(target);
            let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            for file in files {
                zip.start_file(&file.name, options)?;
                zip.write_all(file.content.as_bytes())?;
            }
            zip.finish()?.sync_all()?;
        }
        Ok(())
    };
    write().map_err(|e| format!("导出文件写入失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_duplicate_names_and_wrong_extensions() {
        for names in [vec!["../a.md"], vec!["a.md", "A.md"], vec!["a.doc"], vec!["a.md "]] {
            let files: Vec<_> = names.into_iter().map(|name| ExportFile { name: name.into(), content: "正文".into() }).collect();
            assert!(validate_files(ExportFormat::Markdown, &files).is_err());
        }
    }
    #[test]
    fn zip_contains_unicode_files_and_valid_utf8() {
        let destination = std::env::temp_dir().join(format!("desko-export-test-{}.zip", uuid::Uuid::new_v4()));
        let files = vec![ExportFile { name: "甲.md".into(), content: "你好，世界".into() }, ExportFile { name: "乙.md".into(), content: "- [x] 完成".into() }];
        let (pending, file) = PendingExport::create(&destination).unwrap();
        write_documents(file, &files).unwrap();
        pending.commit(&destination).unwrap();
        let mut archive = zip::ZipArchive::new(File::open(&destination).unwrap()).unwrap();
        assert_eq!(archive.len(), 2);
        let mut text = String::new();
        std::io::Read::read_to_string(&mut archive.by_name("甲.md").unwrap(), &mut text).unwrap();
        assert_eq!(text, "你好，世界");
        drop(archive);
        std::fs::remove_file(destination).unwrap();
    }
    #[test]
    fn abandoned_export_keeps_existing_destination() {
        let destination = std::env::temp_dir().join(format!("desko-export-test-{}.md", uuid::Uuid::new_v4()));
        std::fs::write(&destination, "旧文件").unwrap();
        let (pending, file) = PendingExport::create(&destination).unwrap();
        let temporary = pending.0.clone();
        drop(file);
        drop(pending);
        assert!(!temporary.exists());
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "旧文件");
        std::fs::remove_file(destination).unwrap();
    }
}
