import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/entries' },
    { path: '/entries', name: 'entries', component: () => import('../views/EntriesView.vue') },
    { path: '/notes', name: 'notes', component: () => import('../views/NotesView.vue') },
    { path: '/files', name: 'files', component: () => import('../views/FilesView.vue') },
  ],
})

export default router
