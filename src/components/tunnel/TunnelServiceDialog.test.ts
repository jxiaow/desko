import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { tunnelApi } from '../../services/api/tunnel'
import TunnelServiceDialog from './TunnelServiceDialog.vue'

vi.mock('../../services/api/tunnel', () => ({
  tunnelApi: { addService: vi.fn(), updateService: vi.fn(), setServicePolicy: vi.fn() },
}))

const domain = { name: 'example.com', status: 'active' }
const props = { row: null, busy: false, domain, domainLoading: false, domainError: '' }

describe('通过已授权主域名添加公网服务', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    vi.mocked(tunnelApi.addService).mockResolvedValue([])
    vi.mocked(tunnelApi.updateService).mockResolvedValue([])
  })

  it('自动显示主域名，只填前缀即可预览并保存完整地址', async () => {
    const wrapper = mount(TunnelServiceDialog, { props })
    expect(wrapper.get('.domain-name').text()).toBe('example.com')
    await wrapper.get('#tn-svc-host').setValue('Files')
    await wrapper.get('#tn-svc-port').setValue('8421')
    expect(wrapper.get('.host-preview').text()).toContain('https://files.example.com')
    await wrapper.get('.dialog-footer .btn-primary').trigger('click')
    await flushPromises()
    expect(tunnelApi.addService).toHaveBeenCalledWith({ hostname: 'files.example.com', port: 8421, label: '', preset: '' })
    wrapper.unmount()
  })

  it('未读到主域名时禁止猜地址，显示原因并支持重试', async () => {
    const wrapper = mount(TunnelServiceDialog, { props: { ...props, domain: null, domainError: '连接 Cloudflare 失败' } })
    await wrapper.get('#tn-svc-host').setValue('files')
    await wrapper.get('#tn-svc-port').setValue('8421')
    expect(wrapper.get('.dialog-footer .btn-primary').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('连接 Cloudflare 失败')
    await wrapper.findAll('button').find(button => button.text() === '重试读取主域名')!.trigger('click')
    expect(wrapper.emitted('retryDomain')).toHaveLength(1)
    expect(tunnelApi.addService).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('域名异步返回保留已经填写的前缀、名字和端口', async () => {
    const wrapper = mount(TunnelServiceDialog, { props: { ...props, domain: null, domainLoading: true } })
    await wrapper.get('#tn-svc-host').setValue('docs')
    await wrapper.get('#tn-svc-name').setValue('文档站')
    await wrapper.get('#tn-svc-port').setValue('9090')
    await wrapper.setProps({ domain, domainLoading: false })
    expect(wrapper.get('.host-preview').text()).toContain('https://docs.example.com')
    expect((wrapper.get('#tn-svc-name').element as HTMLInputElement).value).toBe('文档站')
    expect((wrapper.get('#tn-svc-port').element as HTMLInputElement).value).toBe('9090')
    wrapper.unmount()
  })

  it('编辑已有服务自动拆出前缀，保存仍使用原有完整地址', async () => {
    const row = { id: 'one', hostname: 'files.example.com', port: 8421, label: '文件', preset: '', routed: true, listening: true, hasPublicPassword: false, publicReadOnly: true }
    const wrapper = mount(TunnelServiceDialog, { props: { ...props, row } })
    expect((wrapper.get('#tn-svc-host').element as HTMLInputElement).value).toBe('files')
    await wrapper.get('.dialog-footer .btn-primary').trigger('click')
    await flushPromises()
    expect(tunnelApi.updateService).toHaveBeenCalledWith({ id: 'one', hostname: 'files.example.com', port: 8421, label: '文件' })
    wrapper.unmount()
  })

  it('前缀不能带路径或其他主域名，主域名尚未启用时也不能保存', async () => {
    const wrapper = mount(TunnelServiceDialog, { props })
    await wrapper.get('#tn-svc-port').setValue('8421')
    for (const value of ['bad/path', 'files.other.com', '-files', 'files-']) {
      await wrapper.get('#tn-svc-host').setValue(value)
      expect(wrapper.get('.dialog-footer .btn-primary').attributes('disabled')).toBeDefined()
    }
    await wrapper.get('#tn-svc-host').setValue('files')
    await wrapper.setProps({ domain: { ...domain, status: 'pending' } })
    expect(wrapper.get('.dialog-footer .btn-primary').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('尚未启用')
    wrapper.unmount()
  })

  it('明确切换为完整域名时保留已输入的地址', async () => {
    const wrapper = mount(TunnelServiceDialog, { props })
    await wrapper.get('#tn-svc-host').setValue('files.example.com')
    await wrapper.get('#tn-svc-port').setValue('8421')
    expect(wrapper.get('.dialog-err').text()).toContain('前缀须为')
    await wrapper.findAll('button').find(button => button.text() === '手动填写完整域名')!.trigger('click')
    expect((wrapper.get('#tn-svc-host').element as HTMLInputElement).value).toBe('files.example.com')
    await wrapper.get('.dialog-footer .btn-primary').trigger('click')
    await flushPromises()
    expect(tunnelApi.addService).toHaveBeenCalledWith({ hostname: 'files.example.com', port: 8421, label: '', preset: '' })
    wrapper.unmount()
  })
})
