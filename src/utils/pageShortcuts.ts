/** 页面快捷键只处理未被控件消费的按键，弹窗内的输入留给当前弹窗。 */
export function isPageShortcutBlocked(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing
    || (event.target instanceof Element && !!event.target.closest('[role="dialog"], .dialog-overlay'))
}
