//! Commands borrow their authenticated context. Native IPC resolves the desktop
//! state; the Web bridge supplies a separate session sharing only the database.
use std::ops::Deref;
use tauri::{ipc::{CommandArg, CommandItem, InvokeError}, Runtime};

pub struct CommandState<'a, T: Send + Sync + 'static>(&'a T);
impl<'a, T: Send + Sync + 'static> CommandState<'a, T> {
    pub(crate) fn from_ref(state: &'a T) -> Self { Self(state) }
}
impl<T: Send + Sync + 'static> Deref for CommandState<'_, T> {
    type Target = T;
    fn deref(&self) -> &T { self.0 }
}
impl<'r, 'de: 'r, T: Send + Sync + 'static, R: Runtime> CommandArg<'de, R> for CommandState<'r, T> {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        <tauri::State<'r, T> as CommandArg<'de, R>>::from_command(command).map(|state| Self(state.inner()))
    }
}
