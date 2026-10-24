//! 网页渲染：内嵌模板 + 占位符替换。所有动态值在这里统一过 HTML 转义，
//! 调用方传原文。外观不手写：颜色由生成的 tokens.css 出，哪一套由主题戳（config::ThemeStamp）定，
//! 图标由生成的 icons.rs 出，模板只写 `%%I:名字:尺寸%%`。

use crate::config::ThemeStamp;
use crate::files::file_type_icon;
use crate::http_util::{html_escape, url_encode};
use crate::icons::icon;

const HOME: &str = include_str!("templates/home.html");
const LOGIN: &str = include_str!("templates/login.html");
/// App 令牌的逐字副本（scripts/gen-fileshare-assets.mjs 生成）。页面只写 var()，
/// 色板不在模板里重复第二份，改主题只需重跑生成脚本。
const TOKENS: &str = include_str!("templates/tokens.css");

pub const PARTIAL_SEP: &str = "\n---PARTIAL---\n";

const SLOT_MARK: &str = "%%I:";

/// `<html>` 上的外观属性。data-layout 钉死 workspace：tokens.css 整份按这一档复制，
/// 挂成 classic 就没有画布对。四值取自 ThemeStamp 的词表字面量，里面不可能出现引号，
/// 所以这里不走 html_escape。
pub fn html_attrs(stamp: &ThemeStamp) -> String {
    format!(
        r#"data-layout="workspace" data-theme="{}" data-base="{}" data-accent="{}" data-atmosphere="{}""#,
        stamp.theme, stamp.base, stamp.accent, stamp.atmosphere
    )
}

/// 11 档类型 → Solar 图标名。pdf/doc/sheet/deck 共用字面形，分档靠 `--ft-*` 颜色，
/// 与 App 的文件页同一套读法。
fn bucket_glyph(bucket: &str) -> &'static str {
    match bucket {
        "img" => "image",
        "arch" => "archive",
        "code" => "code",
        "mark" => "bulletlist",
        "vid" => "video",
        "audio" => "audio",
        "unk" => "file",
        _ => "doc",
    }
}

/// 把模板里的 `%%I:名字:尺寸%%` 换成现成 SVG。必须在填数据之前跑，
/// 否则一个叫 `%%I:x:14%%` 的文件名会被当真图标展开。
fn fill_icons(html: &str) -> String {
    let mut slots: Vec<&str> = Vec::new();
    let mut rest = html;
    while let Some(pos) = rest.find(SLOT_MARK) {
        match rest[pos + SLOT_MARK.len()..].find("%%") {
            Some(end) => {
                let slot = &rest[pos..pos + SLOT_MARK.len() + end + 2];
                if !slots.contains(&slot) {
                    slots.push(slot);
                }
                rest = &rest[pos + SLOT_MARK.len() + end + 2..];
            }
            None => break,
        }
    }
    let mut out = html.to_string();
    for slot in slots {
        let body = &slot[SLOT_MARK.len()..slot.len() - 2];
        let (name, size) = body.rsplit_once(':').unwrap_or((body, "16"));
        let size = size.parse::<u16>().unwrap_or(16);
        out = out.replace(slot, &icon(name, size));
    }
    out
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

fn split_segs(path: &str) -> Vec<&str> {
    path.split(|c: char| c == '/' || c == '\\')
        .filter(|s| !s.is_empty())
        .collect()
}

/// 路径只留尾部两段：行宽有限，盘符和上层目录是噪音，完整路径放 title。
/// 与 App 的 FileShortcutsModule.pathTail 同规则。
fn path_tail(path: &str) -> String {
    let segs = split_segs(path);
    match segs.len() {
        0 => String::new(),
        1 | 2 => segs.join("/"),
        n => format!("…/{}", segs[n - 2..].join("/")),
    }
}

/// 末段名字，给「落点 docs」这种短提示用
fn path_name(path: &str) -> String {
    split_segs(path).pop().map(str::to_string).unwrap_or_default()
}

/// 宽列形态下的目录列：只给末段，前缀一个省略号表示「上面还有」。
/// 两行堆叠的窄形态用 `path_tail`，两者在 CSS 里互斥，不会同时出现。
fn dir_leaf(path: &str) -> String {
    match split_segs(path).pop() {
        Some(last) => format!("…/{}", last),
        None => String::new(),
    }
}

/// `<script>` 里的字符串字面量：除了引号反斜杠，`< > &` 一律转 \u，
/// 目录名里出现 `</script>` 也炸不出标签。
fn js_str(s: &str) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str(r"\\"),
            '"' => out.push_str(r#"\""#),
            '\n' => out.push_str(r"\n"),
            '\r' => out.push_str(r"\r"),
            '\t' => out.push_str(r"\t"),
            '<' => out.push_str(r"\u003C"),
            '>' => out.push_str(r"\u003E"),
            '&' => out.push_str(r"\u0026"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, r"\u{:04X}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
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

pub fn render_rows(rows: &[RowData], search: &str) -> String {
    if rows.is_empty() {
        let (title, desc) = if search.is_empty() {
            (
                "共享目录里还没有文件".to_string(),
                "点右上「上传」把文件投过来，或直接拖进这一页".to_string(),
            )
        } else {
            (
                format!("没有文件名含「{}」的文件", html_escape(search)),
                "换个关键词，或清空搜索看全部".to_string(),
            )
        };
        return format!(
            r#"<div class="empty">
  <div class="empty-tile">{glyph}</div>
  <b class="empty-t">{title}</b>
  <span class="empty-d">{desc}</span>
</div>"#,
            glyph = icon("searchEmpty", 20),
            title = title,
            desc = desc,
        );
    }
    rows.iter()
        .map(|r| {
            let bucket = file_type_icon(&r.name);
            format!(
                r#"<a class="frow" href="{href}" title="{full}"><span class="tile {bucket}">{glyph}</span><span class="fmain"><div class="fname">{name}</div><div class="fpath mono">{tail}</div></span><span class="fdir mono">{leaf}</span><span class="fsize mono">{size}</span><span class="fdate mono">{modified}</span><span class="dl">{dl}</span></a>"#,
                href = html_escape(&download_href(r.share_index, &r.name)),
                full = html_escape(&r.share_dir),
                bucket = bucket,
                glyph = icon(bucket_glyph(&bucket), 18),
                name = html_escape(&r.name),
                tail = html_escape(&path_tail(&r.share_dir)),
                leaf = html_escape(&dir_leaf(&r.share_dir)),
                size = html_escape(&r.size),
                modified = html_escape(short_modified(&r.modified)),
                dl = icon("download", 14),
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

/// 齿轮里的目录清单：第一个是上传落点，其余只读并标出自己的文件数
fn render_dir_rows(dirs: &[String], counts: &[usize]) -> String {
    if dirs.is_empty() {
        return r#"<div class="dir-row"><span class="p">还没有共享目录，在下方填路径后保存</span></div>"#
            .to_string();
    }
    dirs.iter()
        .enumerate()
        .map(|(i, d)| {
            let badge = if i == 0 {
                r#"<span class="badge ok">上传落点</span>"#.to_string()
            } else {
                let n = counts.get(i).copied().unwrap_or(0);
                format!(r#"<span class="badge mono">{n} 个</span>"#)
            };
            format!(
                r#"<div class="dir-row">{glyph}<span class="p mono" title="{full}">{full}</span>{badge}</div>"#,
                glyph = icon("folder", 16),
                full = html_escape(d),
                badge = badge,
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn replace_all(source: &str, pairs: &[(&str, String)]) -> String {
    let mut out = source.to_string();
    for (key, value) in pairs {
        out = out.replace(key, value);
    }
    out
}

pub struct HomePage<'a> {
    pub stamp: &'a ThemeStamp,
    pub toast: Option<&'a str>,
    pub search_q: &'a str,
    pub count_text: String,
    pub rows_html: String,
    pub share_index: usize,
    pub share_dirs: &'a [String],
    pub dir_counts: &'a [usize],
}

pub fn home_page(ctx: &HomePage) -> String {
    let upload_full = ctx.share_dirs.first().cloned().unwrap_or_default();
    let no_dir = upload_full.is_empty();
    let upload_name = if no_dir { "（未设置）".to_string() } else { path_name(&upload_full) };
    let upload_tail = if no_dir { "还没有共享目录".to_string() } else { path_tail(&upload_full) };
    let upload_hint = if no_dir {
        "还没有共享目录，先点齿轮添加".to_string()
    } else if ctx.share_dirs.len() > 1 {
        format!("{} 个目录可读 · 只有第一个收文件", ctx.share_dirs.len())
    } else {
        "只有这一个目录收文件".to_string()
    };

    replace_all(
        &fill_icons(HOME),
        &[
            ("%%HTML_ATTRS%%", html_attrs(ctx.stamp)),
            ("%%TOKENS%%", TOKENS.to_string()),
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
            ("%%DIR_COUNT%%", ctx.share_dirs.len().to_string()),
            ("%%DIR_ROWS%%", render_dir_rows(ctx.share_dirs, ctx.dir_counts)),
            ("%%DIRS_TEXTAREA%%", html_escape(&ctx.share_dirs.join("\n"))),
            ("%%UPLOAD_DIR_NAME%%", html_escape(&upload_name)),
            ("%%UPLOAD_DIR_TAIL%%", html_escape(&upload_tail)),
            ("%%UPLOAD_HINT%%", html_escape(&upload_hint)),
            ("%%UPLOAD_NAME_JSON%%", js_str(&upload_name)),
            ("%%UPLOAD_FULL_JSON%%", js_str(&upload_full)),
        ],
    )
}

pub fn partial_response(count_text: &str, rows_html: &str) -> String {
    format!("{}{}{}", count_text, PARTIAL_SEP, rows_html)
}

pub fn login_page(err: Option<&str>, next: &str, stamp: &ThemeStamp) -> String {
    replace_all(
        &fill_icons(LOGIN),
        &[
            ("%%HTML_ATTRS%%", html_attrs(stamp)),
            ("%%TOKENS%%", TOKENS.to_string()),
            (
                "%%ERROR%%",
                match err {
                    Some(msg) => html_escape(msg),
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

    fn row(name: &str, dir: &str) -> RowData {
        RowData {
            name: name.to_string(),
            share_index: 0,
            size: "1 B".to_string(),
            modified: "2026-01-01 00:00:00".to_string(),
            share_dir: dir.to_string(),
        }
    }

    #[test]
    fn short_modified_trims_year_and_seconds() {
        assert_eq!(short_modified("2026-09-29 10:56:21"), "09-29 10:56");
        assert_eq!(short_modified("bad"), "bad");
        // 分隔位不对就不猜格式，原样给出，免得把日期改错
        assert_eq!(short_modified("2026-09-29T10:56:21"), "2026-09-29T10:56:21");
    }

    #[test]
    fn tail_and_name_follow_the_app_rules() {
        assert_eq!(path_tail(r"D:\share\docs"), r"…/share/docs");
        assert_eq!(path_tail("/home/u/music"), "…/u/music");
        assert_eq!(path_tail(r"C:\x"), r"C:/x");
        assert_eq!(path_tail(""), "");
        assert_eq!(path_name(r"D:\share\docs"), "docs");
        assert_eq!(path_name("photos/"), "photos");
        assert_eq!(dir_leaf(r"D:\share\docs"), "…/docs");
        assert_eq!(dir_leaf("/home/u/music"), "…/music");
        assert_eq!(dir_leaf(""), "");
    }

    #[test]
    fn js_string_cannot_break_out_of_the_script() {
        assert_eq!(js_str(r#"a\b"c"#), r#""a\\b\"c""#);
        assert_eq!(js_str("</script>"), r#""\u003C/script\u003E""#);
        assert_eq!(js_str("日常"), r#""日常""#);
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
        let html = render_rows(&rows, "");
        assert!(!html.contains("<img src=x"));
        assert!(html.contains("&lt;img"));
        // title 给全路径，.fpath 只给尾两段（两段就够短，不加省略号）
        assert!(html.contains(r#"title="C:\a&amp;b""#));
        assert!(html.contains("C:/a&amp;b"));
        // 宽列形态的 .fdir 只给末段：两形态靠 CSS 互斥，DOM 里同时挂着
        assert!(html.contains(r#"<span class="fdir mono">…/a&amp;b</span>"#));
        // href 里文件名走 url_encode 再 HTML 转义，双保险
        assert!(html.contains("name=%3Cimg"));
        assert!(html.contains("01-01 00:00"));
        assert!(html.contains(r#"class="tile mark""#));
    }

    #[test]
    fn every_bucket_gets_a_real_glyph() {
        for name in ["x.pdf", "x.docx", "x.xlsx", "x.pptx", "x.7z", "x.rs", "x.md", "x.jpg", "x.mkv", "x.mp3", "x.bin"] {
            let html = render_rows(&[row(name, "D:\\s")], "");
            assert!(html.contains(r#"<svg width="18" height="18""#), "{name}");
        }
    }

    #[test]
    fn empty_rows_render_empty_state() {
        let html = render_rows(&[], "");
        assert!(html.contains("empty-t"));
        assert!(html.contains("共享目录里还没有文件"));
        assert!(html.contains(r#"width="20""#), "空态用 searchEmpty 字面形");
        // 上传是弹窗不是页签，空态只能把话递给页条那颗钮
        assert!(html.contains("点右上「上传」"), "{html}");
        assert!(!html.contains("页签"), "{html}");
    }

    #[test]
    fn empty_rows_after_search_say_so() {
        let html = render_rows(&[], "周报<a>");
        assert!(html.contains("没有文件名含「周报&lt;a&gt;」的文件"));
        assert!(!html.contains("周报<a>"));
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
    fn html_attrs_puts_the_stamp_on_the_root() {
        let stamp = ThemeStamp::normalize("ink", "dark", "teal", "on");
        let attrs = html_attrs(&stamp);
        assert!(attrs.contains(r#"data-layout="workspace""#), "{attrs}");
        assert!(attrs.contains(r#"data-theme="ink""#), "{attrs}");
        assert!(attrs.contains(r#"data-base="dark""#), "{attrs}");
        assert!(attrs.contains(r#"data-accent="teal""#), "{attrs}");
        assert!(attrs.contains(r#"data-atmosphere="on""#), "{attrs}");
    }

    #[test]
    fn fill_icons_leaves_no_slot_and_only_uses_the_table() {
        let out = fill_icons(r#"<b>%%I:gear:16%%</b><i>%%I:search:14%%</i><u>%%I:gear:16%%</u>"#);
        assert!(!out.contains(SLOT_MARK), "{out}");
        assert_eq!(out.matches(r#"<svg width="16""#).count(), 2);
        assert_eq!(out.matches(r#"<svg width="14""#).count(), 1);
    }

    #[test]
    fn home_page_replaces_all_placeholders() {
        let dirs = vec![r"D:\sh<>&a".to_string(), r"D:\photos".to_string()];
        let counts = [3usize, 128usize];
        let stamp = ThemeStamp::default();
        let html = home_page(&HomePage {
            stamp: &stamp,
            toast: Some("上传完成"),
            search_q: "",
            count_text: "3 个文件".to_string(),
            rows_html: "<div></div>".to_string(),
            share_index: 0,
            share_dirs: &dirs,
            dir_counts: &counts,
        });
        assert!(!html.contains("%%"), "首页留了没填的槽");
        // 模板里的槽位真挂在 <html> 上，否则整套令牌都不会被激活
        assert!(html.contains(r#"<html lang="zh-CN" data-layout="workspace""#), "{html}");
        // 令牌随页面下发，网页不再自带色板
        assert!(html.contains("--ft-pdf"), "tokens.css 没注入");
        assert!(html.contains(&html_attrs(&stamp)));
        assert!(html.contains("上传完成"));
        assert!(html.contains("SHARE_INDEX = 0;"));
        assert!(html.contains("3 个文件"));
        assert!(html.contains("· 2 个目录"));
        // 设置弹窗随首页渲染，目录里的特殊字符一律转义
        assert!(html.contains(r"D:\sh&lt;&gt;&amp;a"));
        assert!(html.contains(r#""D:\\sh\u003C\u003E\u0026a""#), "落点全路径进 JS 要过两道");
        assert!(html.contains("落到 D:/sh&lt;&gt;&amp;a"), "上传弹窗头部的落点短路径");
        assert!(html.contains("2 个目录可读 · 只有第一个收文件"), "弹窗底栏的空闲提示");
        // r2：上传回到弹窗，页条不再挂页签
        assert!(html.contains(r#"class="btn-primary" id="btn-upload""#));
        assert!(!html.contains(r#"data-tab=""#), "首页不该还有页签状态");
        assert!(!html.contains("id=\"btn-text\""), "文字档住在弹窗里，页条不给第二个入口");
        assert!(html.contains(r#"<span class="badge ok">上传落点</span>"#));
        assert!(html.contains(r#"<span class="badge mono">128 个</span>"#));
        assert!(!html.contains(">3 个</span>"), "第一个目录挂落点徽标，不重复报条数");
    }

    #[test]
    fn home_page_survives_no_upload_dir() {
        let html = home_page(&HomePage {
            stamp: &ThemeStamp::default(),
            toast: None,
            search_q: "",
            count_text: "0 个文件".to_string(),
            rows_html: String::new(),
            share_index: 0,
            share_dirs: &[],
            dir_counts: &[],
        });
        assert!(!html.contains("%%"));
        assert!(html.contains("var UPLOAD_NAME = \"（未设置）\";"), "{html}");
        assert!(html.contains(r#"var UPLOAD_FULL = """#));
        assert!(html.contains("还没有共享目录，在下方填路径后保存"));
        assert!(html.contains(r#"<span class="st" id="up-st">还没有共享目录，先点齿轮添加</span>"#), "{html}");
    }

    #[test]
    fn login_page_sanitizes_next() {
        let html = login_page(Some("口令不正确"), r#"/"onmouseover="x"#, &ThemeStamp::default());
        assert!(html.contains("口令不正确"));
        // 引号被转义，next 参数无法闭合属性
        assert!(!html.contains(r#"value="/""#));
        assert!(html.contains("&quot;"));
        assert!(!html.contains("%%"), "登录页留了没填的槽");
        assert!(html.contains("--ft-pdf"), "令牌没注入");
        // 显隐两颗眼都在，JS 只切 class
        assert!(html.contains(r#"class="on"><svg"#) && html.contains(r#"class="off"><svg"#));
    }

    #[test]
    fn login_page_keeps_the_error_slot_when_absent() {
        let html = login_page(None, "/", &ThemeStamp::default());
        // 槽固定 20px：没有报错也留着，卡片不跳动
        assert!(html.contains(r#"<div class="err-slot"></div>"#), "{html}");
    }
}
