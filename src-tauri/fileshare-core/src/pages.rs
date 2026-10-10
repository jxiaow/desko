//! 网页渲染：内嵌模板 + 占位符替换。所有动态值在这里统一过 HTML 转义，
//! 调用方传原文。视觉基准 = desko 主窗口设计令牌（paper/ink × 墨蓝）。

use crate::files::file_type_icon;
use crate::http_util::{html_escape, url_encode};

const HOME: &str = include_str!("templates/home.html");
const LOGIN: &str = include_str!("templates/login.html");

pub const PARTIAL_SEP: &str = "\n---PARTIAL---\n";

const ICON_DOC: &str = r#"<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>"#;
const ICON_IMG: &str = r#"<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>"#;
const ICON_ZIP: &str = r#"<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>"#;
const ICON_VID: &str = r#"<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>"#;
const ICON_CODE: &str = r#"<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>"#;
const ICON_DEFAULT: &str = r#"<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>"#;
const ICON_DL: &str = r#"<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="3" x2="12" y2="15"/></svg>"#;
const ICON_DIR: &str = r#"<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>"#;

fn icon_svg(kind: &str) -> &'static str {
    match kind {
        "doc" => ICON_DOC,
        "img" => ICON_IMG,
        "zip" => ICON_ZIP,
        "vid" => ICON_VID,
        "code" => ICON_CODE,
        _ => ICON_DEFAULT,
    }
}

/// "2026-09-29 10:56:21" → "09-29 10:56"；格式不符原样返回
fn short_modified(m: &str) -> &str {
    let b = m.as_bytes();
    if b.len() >= 16 && b[4] == b'-' && b[7] == b'-' && b[10] == b' ' && b[13] == b':' {
        &m[5..16]
    } else {
        m
    }
}

pub fn download_href(share_index: usize, name: &str) -> String {
    format!("/download?share={}&name={}", share_index, url_encode(name))
}

pub struct RowData {
    pub name: String,
    pub share_index: usize,
    pub size: String,
    pub modified: String,
    pub share_dir: String,
}

pub fn render_rows(rows: &[RowData]) -> String {
    if rows.is_empty() {
        return r#"<div class="empty">
          <div class="empty-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg></div>
          <b class="empty-t">暂无文件</b>
          <span class="empty-d">点右上角「上传」，或把文件拖到页面上</span>
        </div>"#
            .to_string();
    }
    rows.iter()
        .map(|r| {
            let kind = file_type_icon(&r.name);
            format!(
                r#"<a class="row" href="{href}"><span class="fico {kind}">{icon}</span><span class="fmain"><div class="fname">{name}</div><div class="fpath">{dir}</div></span><span class="fsize">{size}</span><span class="fdate">{modified}</span><span class="fdl">{dl}</span></a>"#,
                href = html_escape(&download_href(r.share_index, &r.name)),
                kind = kind,
                icon = icon_svg(kind),
                name = html_escape(&r.name),
                dir = html_escape(&r.share_dir),
                size = html_escape(&r.size),
                modified = html_escape(short_modified(&r.modified)),
                dl = ICON_DL,
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// 滚动续加哨兵行：还有下一页时挂在列表尾部，data-page 即下一页号；没有则空串
pub fn render_more(next_page: usize, search: &str) -> String {
    format!(
        r#"<div class="more" data-page="{}" data-q="{}"><span class="spin"></span>加载更多</div>"#,
        next_page,
        html_escape(search),
    )
}

/// 行尾拼哨兵：next_page 为 0 表示已到末页，不挂
pub fn render_more_and(next_page: usize, search: &str, rows_html: &str) -> String {
    if next_page == 0 {
        rows_html.to_string()
    } else {
        format!("{}\n{}", rows_html, render_more(next_page, search))
    }
}

fn replace_all(source: &str, pairs: &[(&str, String)]) -> String {
    let mut out = source.to_string();
    for (key, value) in pairs {
        out = out.replace(key, value);
    }
    out
}

pub struct HomePage<'a> {
    pub lan_url: &'a str,
    pub toast: Option<&'a str>,
    pub search_q: &'a str,
    pub count_text: String,
    pub rows_html: String,
    pub share_index: usize,
    pub upload_dir: &'a str,
    pub share_dirs: &'a [String],
}

pub fn home_page(ctx: &HomePage) -> String {
    let dir_items = ctx
        .share_dirs
        .iter()
        .map(|d| format!(r#"<div class="dir-row">{icon}{}</div>"#, html_escape(d), icon = ICON_DIR))
        .collect::<Vec<_>>()
        .join("\n");
    replace_all(
        HOME,
        &[
            ("%%LAN_URL%%", html_escape(ctx.lan_url)),
            (
                "%%TOAST%%",
                match ctx.toast {
                    Some(m) => format!(r#"<div class="toast">{}</div>"#, html_escape(m)),
                    None => String::new(),
                },
            ),
            ("%%SEARCH_Q%%", html_escape(ctx.search_q)),
            ("%%COUNT%%", html_escape(&ctx.count_text)),
            ("%%ROWS%%", ctx.rows_html.clone()),
            ("%%SHARE_INDEX%%", ctx.share_index.to_string()),
            ("%%UPLOAD_DIR%%", html_escape(ctx.upload_dir)),
            ("%%DIR_COUNT%%", ctx.share_dirs.len().to_string()),
            ("%%DIR_ITEMS%%", dir_items),
            ("%%DIRS_TEXTAREA%%", html_escape(&ctx.share_dirs.join("\n"))),
        ],
    )
}

pub fn partial_response(count_text: &str, rows_html: &str) -> String {
    format!("{}{}{}", count_text, PARTIAL_SEP, rows_html)
}

pub fn login_page(err: Option<&str>, next: &str) -> String {
    replace_all(
        LOGIN,
        &[
            (
                "%%ERROR%%",
                match err {
                    Some(msg) => format!(r#"<div class="err">{}</div>"#, html_escape(msg)),
                    None => String::new(),
                },
            ),
            ("%%NEXT%%", html_escape(next)),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_modified_trims_year_and_seconds() {
        assert_eq!(short_modified("2026-09-29 10:56:21"), "09-29 10:56");
        assert_eq!(short_modified("bad"), "bad");
        assert_eq!(short_modified("2026/09/29 10:56:21"), "2026/09/29 10:56:21");
    }

    #[test]
    fn rows_escape_xss_vectors() {
        let rows = vec![RowData {
            name: "<img src=x onerror=alert(1)>.txt".to_string(),
            share_index: 0,
            size: "1 B".to_string(),
            modified: "2026-01-01 00:00:00".to_string(),
            share_dir: r"C:\a&b".to_string(),
        }];
        let html = render_rows(&rows);
        assert!(!html.contains("<img src=x"));
        assert!(html.contains("&lt;img"));
        assert!(html.contains(r"C:\a&amp;b"));
        // href 里文件名走 url_encode 再 HTML 转义，双保险
        assert!(html.contains("name=%3Cimg"));
        assert!(html.contains("01-01 00:00"));
    }

    #[test]
    fn empty_rows_render_empty_state() {
        let html = render_rows(&[]);
        assert!(html.contains("empty-t"));
        assert!(html.contains("暂无文件"));
    }

    #[test]
    fn more_sentinel_carries_page_and_query() {
        let html = render_more(3, "照片&x");
        assert!(html.contains(r#"data-page="3""#));
        assert!(html.contains(r#"data-q="照片&amp;x""#));
        assert!(html.contains("more"));
    }

    #[test]
    fn partial_protocol_matches_js_splitter() {
        let out = partial_response("7 个文件", "<div>x</div>");
        let sep_pos = out.find(PARTIAL_SEP).unwrap();
        assert_eq!(&out[..sep_pos], "7 个文件");
        // 前端按 indexOf(sep)+SEP.len() 取正文，确保分隔符恰为 15 字符
        assert_eq!(PARTIAL_SEP.len(), 15);
        assert_eq!(&out[sep_pos + 15..], "<div>x</div>");
    }

    #[test]
    fn home_page_replaces_all_placeholders() {
        let dirs = vec![r"D:\sh<>&a".to_string()];
        let html = home_page(&HomePage {
            lan_url: "http://192.168.1.5:8000",
            toast: Some("上传完成"),
            search_q: "",
            count_text: "3 个文件".to_string(),
            rows_html: "<div></div>".to_string(),
            share_index: 0,
            upload_dir: &dirs[0],
            share_dirs: &dirs,
        });
        assert!(!html.contains("%%"));
        assert!(html.contains("http://192.168.1.5:8000"));
        assert!(html.contains("上传完成"));
        assert!(html.contains("/upload?share=0"));
        // 设置弹窗随首页渲染，目录里的特殊字符一律转义
        assert!(html.contains(r"D:\sh&lt;&gt;&amp;a"));
        assert!(html.contains("当前共 1 个目录"));
    }

    #[test]
    fn login_page_sanitizes_next() {
        let html = login_page(Some("口令不正确"), r#"/"onmouseover="x"#);
        assert!(html.contains("口令不正确"));
        // 引号被转义，next 参数无法闭合属性
        assert!(!html.contains(r#"value="/""#));
        assert!(html.contains("&quot;"));
    }

    #[test]
    fn login_page_omits_error_block_when_absent() {
        let html = login_page(None, "/");
        assert!(!html.contains(r#"<div class="err">"#), "首次进登录页不该有报错行");
    }
}
