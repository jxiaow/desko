use super::environment::{capture, Environment};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

pub fn directory(value: &str) -> Result<String, String> {
    let path = Path::new(value);
    if !path.is_absolute() || !path.is_dir() { return Err("请选择有效的本机工作目录".into()); }
    let path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    let text = path.to_str().ok_or("工作目录不是有效的 Unicode 路径")?;
    #[cfg(windows)]
    { return Ok(if let Some(rest) = text.strip_prefix(r"\\?\UNC\") { format!(r"\\{rest}") } else { text.strip_prefix(r"\\?\").unwrap_or(text).to_owned() }); }
    #[cfg(not(windows))]
    Ok(text.to_owned())
}

pub fn same_path(a: &str, b: &str) -> bool {
    if cfg!(windows) { a.replace('/', "\\").eq_ignore_ascii_case(&b.replace('/', "\\")) } else { a == b }
}

fn git(environment: &Environment, cwd: &str, args: &[&str]) -> Result<String, String> {
    let (output, success) = capture(environment.git(cwd, args)?, Duration::from_secs(15))?;
    if !success { return Err("该目录不是 Git 仓库，或所选环境中的 Git 无法读取它".into()); }
    Ok(String::from_utf8_lossy(&output).into_owned())
}

pub fn parse_status(output: &str) -> Vec<Value> {
    let mut entries = output.split('\0');
    let mut files = vec![];
    while let Some(value) = entries.next() {
        if value.len() < 3 || !value.is_char_boundary(3) { continue; }
        let code = &value[..2];
        let mut file = json!({"status":code.trim(),"path":&value[3..]});
        if code.contains(['R', 'C']) { file["originalPath"] = json!(entries.next().unwrap_or("")); }
        files.push(file);
    }
    files
}

pub fn status(environment: &Environment, cwd: &str) -> Value {
    let mut result = json!({"name":Path::new(cwd).file_name().unwrap_or_default().to_string_lossy(),"path":cwd,"branch":"","files":[]});
    let details = (|| -> Result<(), String> {
        let branch = git(environment, cwd, &["branch", "--show-current"])?;
        let output = git(environment, cwd, &["status", "--porcelain=v1", "-z"])?;
        result["branch"] = json!(if branch.trim().is_empty() { "HEAD" } else { branch.trim() });
        result["files"] = json!(parse_status(&output));
        Ok(())
    })();
    if let Err(error) = details { result["error"] = json!(error); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn porcelain_paths_preserve_spaces_unicode_and_renames() {
        let files = parse_status(" M 路径 a.ts\0R  new name\0old name\0?? b\0");
        assert_eq!(files.len(), 3);
        assert_eq!(files[0]["path"], "路径 a.ts");
        assert_eq!(files[1]["originalPath"], "old name");
    }
}
