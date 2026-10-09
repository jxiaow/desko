import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/notes' },
    { path: '/entries', name: 'entries', meta: { title: '网址收藏' }, component: () => import('../views/EntriesView.vue') },
    { path: '/notes', name: 'notes', meta: { title: '小记' }, component: () => import('../views/NotesView.vue') },
    { path: '/files', name: 'files', meta: { title: '文件快捷' }, component: () => import('../views/FilesView.vue') },
    { path: '/mfa', name: 'mfa', meta: { title: '验证码' }, component: () => import('../views/MfaView.vue') },
    { path: '/fileshare', name: 'fileshare', meta: { title: '局域网传输' }, component: () => import('../views/FileshareView.vue') },
  ],
})

export default router
