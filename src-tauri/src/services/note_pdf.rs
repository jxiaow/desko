//! PDF 使用独立隐藏窗口，不执行正文脚本、不授予应用 IPC 权限。
use std::path::Path;
use tauri::{WebviewUrl, WebviewWindowBuilder};

struct PrintDocument(std::path::PathBuf);
impl Drop for PrintDocument {
    fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
}
struct PrintWindow(tauri::WebviewWindow);
impl Drop for PrintWindow {
    fn drop(&mut self) { let _ = self.0.destroy(); }
}

#[cfg(windows)]
pub async fn print_html(app: &tauri::AppHandle, html: &str, path: &Path) -> Result<(), String> {
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, NavigationCompletedEventHandler, PrintToPdfCompletedHandler, take_pwstr};
    use windows_webview::core::{BOOL, HSTRING, Interface, PWSTR};

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let destination = std::path::absolute(path).map_err(|e| e.to_string())?.to_string_lossy().into_owned();
    let job = uuid::Uuid::new_v4().to_string();
    // NavigateToString 有大小限制；图片内嵌的文档用私有临时 HTML，窗口关闭后立即清理。
    let source = PrintDocument(std::env::temp_dir().join(format!("desko-export-{job}.html")));
    use std::io::Write;
    let secure = html.replacen("<head>", "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:\">", 1);
    if secure == html { return Err("打印文档缺少页面头部".into()); }
    std::fs::OpenOptions::new().write(true).create_new(true).open(&source.0)
        .and_then(|mut file| file.write_all(secure.as_bytes())).map_err(|e| format!("无法准备打印文档：{e}"))?;
    let url = tauri::Url::from_file_path(&source.0).map_err(|_| "打印文档路径无效")?.to_string();
    let window = WebviewWindowBuilder::new(app, format!("export-{job}"),
        WebviewUrl::External("about:blank".parse().unwrap()))
        .title("小记导出")
        .visible(false)
        .focused(false)
        .inner_size(794.0, 1123.0)
        .build().map_err(|e| format!("无法创建 PDF 导出窗口：{e}"))?;
    let window = PrintWindow(window);
    let sender = tx.clone();
    let setup = window.0.with_webview(move |platform| {
        let result = (|| -> windows_webview::core::Result<()> {
            let core = unsafe { platform.controller().CoreWebView2()? };
            unsafe { core.Settings()?.SetIsScriptEnabled(false)?; }
            let environment = platform.environment();
            let token = std::rc::Rc::new(std::cell::Cell::new(0));
            let callback_token = token.clone();
            let completed = sender.clone();
            // 原生加载事件不依赖正文脚本，CSP 与关闭 JS 时仍能收到。
            let loaded = NavigationCompletedEventHandler::create(Box::new(move |core, args| {
                let Some(core) = core else { return Ok(()); };
                let mut success = BOOL::default();
                if let Some(args) = args { unsafe { args.IsSuccess(&mut success)?; } }
                if !success.as_bool() { return Ok(()); }
                let mut source = PWSTR::null();
                unsafe { core.Source(&mut source)?; }
                if !take_pwstr(source).contains(&format!("desko-export-{job}.html")) { return Ok(()); }
                unsafe { core.remove_NavigationCompleted(callback_token.get())?; }
                let result = (|| -> windows_webview::core::Result<()> {
                    let printer: ICoreWebView2_7 = core.cast()?;
                    let environment: ICoreWebView2Environment6 = environment.cast()?;
                    let settings = unsafe { environment.CreatePrintSettings()? };
                    unsafe {
                        settings.SetShouldPrintBackgrounds(true)?;
                        settings.SetShouldPrintHeaderAndFooter(false)?;
                        settings.SetPageWidth(8.2677)?;
                        settings.SetPageHeight(11.6929)?;
                        settings.SetMarginTop(0.55)?;
                        settings.SetMarginBottom(0.55)?;
                        settings.SetMarginLeft(0.55)?;
                        settings.SetMarginRight(0.55)?;
                    }
                    let printed = completed.clone();
                    let callback = PrintToPdfCompletedHandler::create(Box::new(move |result, success| {
                        let result = result.map_err(|e| format!("PDF 打印失败：{e}"))
                            .and_then(|_| if success { Ok(()) } else { Err("PDF 文件未能写入".into()) });
                        let _ = printed.send(result);
                        Ok(())
                    }));
                    unsafe { printer.PrintToPdf(&HSTRING::from(destination.as_str()), &settings, &callback)?; }
                    Ok(())
                })();
                if let Err(error) = result { let _ = completed.send(Err(format!("PDF 引擎不可用：{error}"))); }
                Ok(())
            }));
            let mut registration = 0;
            unsafe { core.add_NavigationCompleted(&loaded, &mut registration)?; }
            token.set(registration);
            unsafe { core.Navigate(&HSTRING::from(url))?; }
            Ok(())
        })();
        if let Err(error) = result { let _ = sender.send(Err(format!("无法访问 PDF 引擎：{error}"))); }
    });
    if let Err(error) = setup { let _ = tx.send(Err(format!("无法访问 PDF 窗口：{error}"))); }
    let result = match tokio::time::timeout(std::time::Duration::from_secs(60), rx.recv()).await {
        Ok(Some(result)) => result,
        Ok(None) => Err("PDF 导出已中断".into()),
        Err(_) => Err("PDF 导出超时，请减少条数后重试".into()),
    };
    result
}

#[cfg(not(windows))]
pub async fn print_html(_app: &tauri::AppHandle, _html: &str, _path: &Path) -> Result<(), String> {
    Err("PDF 导出目前支持 Windows 桌面版".into())
}
