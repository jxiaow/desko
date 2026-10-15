use crate::db::{Database, Note, CreateNoteInput, UpdateNoteInput};
use crate::error::AppError;

pub fn create_note(db: &Database, input: CreateNoteInput) -> Result<Note, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    let note = Note {
        id,
        title: input.title,
        content_html: input.content_html,
        category: input.category,
        created_at: now,
        updated_at: now,
        pinned: false,
        starred: false,
        encrypted: false,
        archived: false,
        archived_at: None,
    };

    db.create_note(&note)?;
    Ok(note)
}

pub fn update_note(db: &Database, id: &str, input: UpdateNoteInput) -> Result<(), AppError> {
    let mut note = db.get_note(id)?.ok_or(AppError::Database("note not found".to_string()))?;
    note.title = input.title;
    note.content_html = input.content_html;
    note.category = input.category;
    note.updated_at = chrono::Utc::now().timestamp_millis();

    db.update_note(&note)?;
    Ok(())
}

pub fn toggle_pin_note(db: &Database, id: &str) -> Result<bool, AppError> {
    db.toggle_pin_note(id)
}

/// 锁着的加密小记也要认得出是哪一条：只有正文首块真是标题（h1–h3）才把这行留成明文。
/// 正文首行不当标题，否则加密就形同虚设；没有真标题返回空串，前端退回「已加密」占位
pub fn heading_title(html: &str) -> String {
    let rest = html.trim_start();
    let lower = rest.to_ascii_lowercase();
    let Some(tag) = ["h1", "h2", "h3"].into_iter().find(|t| lower.starts_with(&format!("<{t}"))) else {
        return String::new();
    };
    let Some(open_end) = lower.find('>') else { return String::new() };
    let close = format!("</{tag}>");
    let Some(close_rel) = lower[open_end..].find(&close) else { return String::new() };
    // 大小写折叠不改变 ASCII 字节数，所以小写串上的下标能直接切原文
    let inner = &rest[open_end + 1..open_end + close_rel];
    plain_text(inner).trim().chars().take(20).collect::<String>()
}

/// 标题里的内联标记（strong/code/…）去掉，实体还原成字符，一趟扫完
fn plain_text(src: &str) -> String {
    const ENTITIES: [(&str, char); 5] = [
        ("&amp;", '&'),
        ("&lt;", '<'),
        ("&gt;", '>'),
        ("&quot;", '"'),
        ("&#39;", '\''),
    ];
    let mut out = String::new();
    let mut rest = src;
    while let Some(i) = rest.find(['<', '&']) {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        if tail.starts_with('<') {
            rest = match tail.find('>') {
                Some(end) => &tail[end + 1..],
                None => "",
            };
            continue;
        }
        match ENTITIES.iter().find(|(code, _)| tail.starts_with(code)) {
            Some((code, ch)) => {
                out.push(*ch);
                rest = &tail[code.len()..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn toggle_star_note(db: &Database, id: &str) -> Result<bool, AppError> {
    db.toggle_star_note(id)
}

pub fn set_note_archived(db: &Database, id: &str, archived: bool) -> Result<bool, AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    db.set_note_archived(id, archived, now)
}

pub fn batch_set_archived(db: &Database, ids: &[String], archived: bool) -> Result<usize, AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    db.batch_set_archived(ids, archived, now)
}

#[cfg(test)]
mod tests {
    use super::heading_title;

    #[test]
    fn only_a_real_heading_survives_as_plaintext() {
        assert_eq!(heading_title("<h2>三月调档</h2><p>正文</p>"), "三月调档");
        assert_eq!(heading_title("  <h1>甲</h1>"), "甲");
        // 正文首行不是标题：锁着的时候不外泄
        assert_eq!(heading_title("<p>正文开头</p><h2>甲</h2>"), "");
        assert_eq!(heading_title("<ul><li>清单一</li></ul>"), "");
        assert_eq!(heading_title("<h2></h2><p>正文</p>"), "");
        assert_eq!(heading_title(""), "");
    }

    #[test]
    fn heading_text_is_stripped_and_capped() {
        assert_eq!(heading_title("<h3><strong>RecordView</strong> 与 <code>Controller</code></h3>"), "RecordView 与 Control");
        assert_eq!(heading_title("<h2>A &amp; B &lt;tag&gt;</h2>"), "A & B <tag>");
        assert_eq!(heading_title(&format!("<h2>{}</h2>", "长".repeat(30))).chars().count(), 20);
        // 标签没闭合就当没有标题，不猜内容
        assert_eq!(heading_title("<h2>没关上"), "");
    }
}
