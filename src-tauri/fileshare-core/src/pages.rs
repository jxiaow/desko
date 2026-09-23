//! 网页渲染：内嵌模板 + 占位符替换。所有动态值在这里统一过 HTML 转义，
//! 调用方传原文。视觉基准 ftp/templates。

use crate::files::file_type_icon;
use crate::http_util::{html_escape, url_encode};

const HOME: &str = include_str!("templates/home.html");
const LOGIN: &str = include_str!("templates/login.html");

pub const PARTIAL_SEP: &str = "\n---PARTIAL---\n";

const ICON_DOC: &str = r#"<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>"#;
const ICON_IMG: &str = r#"<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>"#;
const ICON_ZIP: &str = r#"<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>"#;
const ICON_VID: &str = r#"<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>"#;
const ICON_CODE: &str = r#"<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>"#;
const ICON_DEFAULT: &str = r#"<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>"#;
const ICON_DL: &str = r#"<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>"#;

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

/// 首页 URL：无参数即默认视图（全部目录、按时间倒序、第 1 页）
pub fn build_home_url(page: Option<usize>, search: Option<&str>) -> String {
    let mut params: Vec<String> = Vec::new();
    if let Some(p) = page {
        if p > 1 {
            params.push(format!("page={}", p));
        }
    }
    if let Some(q) = search {
        if !q.is_empty() {
            params.push(format!("q={}", url_encode(q)));
        }
    }
    if params.is_empty() {
        "/".to_string()
    } else {
        format!("/?{}", params.join("&"))
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
          <div class="empty-ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg></div>
          <div class="empty-t">暂无文件</div>
          <div class="empty-d">点击右下角按钮上传</div>
        </div>"#
            .to_string();
    }
    rows.iter()
        .map(|r| {
            let kind = file_type_icon(&r.name);
            format!(
                r#"<a class="fl-row" href="{href}"><div class="fl-ico {kind}">{icon}</div><div class="fl-name"><b>{name}</b><s>{dir}</s></div><span class="fl-sz">{size}</span><span class="fl-dt">{modified}</span><span class="fl-act">{dl}</span></a>"#,
                href = html_escape(&download_href(r.share_index, &r.name)),
                kind = kind,
                icon = icon_svg(kind),
                name = html_escape(&r.name),
                dir = html_escape(&r.share_dir),
                size = html_escape(&r.size),
                modified = html_escape(&r.modified),
                dl = ICON_DL,
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn render_pagination(total_pages: usize, current: usize, search: &str) -> String {
    if total_pages <= 1 {
        return String::new();
    }
    let link = |p: usize, label: &str, cls: &str| {
        format!(
            r#"<a class="{}" href="{}">{}</a>"#,
            cls,
            html_escape(&build_home_url(Some(p), Some(search))),
            label
        )
    };
    let mut parts = vec![format!(
        r#"<div class="pg-wrap"><span class="pg-info">{} / {}</span>"#,
        current, total_pages
    )];
    if current > 1 {
        parts.push(link(current - 1, "&laquo;", "pg"));
    }
    // 窗口化：首尾 + 当前±2，缺口用省略号占位，页数再多链接数也封顶
    let shown: Vec<usize> = (1..=total_pages)
        .filter(|p| *p == 1 || *p == total_pages || p.abs_diff(current) <= 2)
        .collect();
    let mut prev = 0usize;
    for p in shown {
        if p > prev + 1 {
            parts.push(r#"<span class="pg-gap">…</span>"#.to_string());
        }
        prev = p;
        if p == current {
            parts.push(format!(r#"<span class="pg on">{}</span>"#, p));
        } else {
            parts.push(link(p, &p.to_string(), "pg"));
        }
    }
    if current < total_pages {
        parts.push(link(current + 1, "&raquo;", "pg"));
    }
    parts.push("</div>".to_string());
    parts.join("")
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
    pub pagination_html: String,
    pub share_index: usize,
    pub share_dirs: &'a [String],
}

pub fn home_page(ctx: &HomePage) -> String {
    let dir_items = ctx
        .share_dirs
        .iter()
        .map(|d| format!(
            r#"<div class="dir-item"><span class="dir-ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>{}</div>"#,
            html_escape(d)
        ))
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
            ("%%PAGINATION%%", ctx.pagination_html.clone()),
            ("%%SHARE_INDEX%%", ctx.share_index.to_string()),
            ("%%DIR_COUNT%%", ctx.share_dirs.len().to_string()),
            ("%%DIR_ITEMS%%", dir_items),
            ("%%DIRS_TEXTAREA%%", html_escape(&ctx.share_dirs.join("\n"))),
        ],
    )
}

pub fn partial_response(count_text: &str, rows_html: &str, pagination_html: &str) -> String {
    format!(
        "{}{}<div class=\"file-list\" id=\"file-list\">\n{}\n      </div>\n{}",
        count_text, PARTIAL_SEP, rows_html, pagination_html
    )
}

pub fn login_page(error: bool, next: &str) -> String {
    replace_all(
        LOGIN,
        &[
            (
                "%%ERROR%%",
                if error {
                    r#"<div class="err">口令不正确</div>"#.to_string()
                } else {
                    String::new()
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
    fn home_url_param_building() {
        assert_eq!(build_home_url(None, None), "/");
        assert_eq!(build_home_url(Some(1), None), "/");
        assert_eq!(build_home_url(Some(3), None), "/?page=3");
        assert_eq!(build_home_url(None, Some("a b")), "/?q=a+b");
        assert_eq!(build_home_url(Some(2), Some("中文")), "/?page=2&q=%E4%B8%AD%E6%96%87");
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
        assert!(html.contains("C:\\a&amp;b"));
        // href 里文件名走 url_encode 再 HTML 转义，双保险
        assert!(html.contains("name=%3Cimg"));
    }

    #[test]
    fn empty_rows_render_empty_state() {
        let html = render_rows(&[]);
        assert!(html.contains("empty-t"));
        assert!(html.contains("暂无文件"));
    }

    #[test]
    fn pagination_hidden_for_single_page_and_preserves_search() {
        assert_eq!(render_pagination(1, 1, ""), "");
        let html = render_pagination(3, 2, "照片");
        assert!(html.contains("2 / 3"));
        assert!(html.contains("class=\"pg on\">2<"));
        assert!(html.contains("q=%E7%85%A7%E7%89%87"));
        assert!(!html.contains("sort="));
    }

    #[test]
    fn pagination_windows_large_page_counts() {
        let html = render_pagination(100, 50, "");
        // 首尾 + 当前±2 = 7 个页码（当前页是 span.on），外加首尾两个 « »：class="pg" 共 8 个链接
        assert_eq!(html.matches("class=\"pg\"").count(), 8);
        assert!(html.contains("pg-gap"));
        assert!(html.contains(">1<"));
        assert!(html.contains(">100<"));
        assert!(!html.contains(">10<"));
        assert!(!html.contains(">46<"));
        assert!(!html.contains(">54<"));
    }

    #[test]
    fn partial_protocol_matches_js_splitter() {
        let out = partial_response("7 个文件", "<div>x</div>", "");
        let sep_pos = out.find(PARTIAL_SEP).unwrap();
        assert_eq!(&out[..sep_pos], "7 个文件");
        // 前端按 indexOf(sep)+15 取正文，确保分隔符恰为 15 字符
        assert_eq!(PARTIAL_SEP.len(), 15);
        assert_eq!(&out[sep_pos + 15..], "<div class=\"file-list\" id=\"file-list\">\n<div>x</div>\n      </div>\n");
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
            pagination_html: "".to_string(),
            share_index: 0,
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
        let html = login_page(true, r#"/"onmouseover="x"#);
        assert!(html.contains("口令不正确"));
        // 引号被转义，next 参数无法闭合属性
        assert!(!html.contains(r#"value="/""#));
        assert!(html.contains("&quot;"));
    }
}
