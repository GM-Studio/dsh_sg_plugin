import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import CustomerPanel from '../src/components/CustomerPanel.vue';
import { customerApi } from '../src/api/customers';

vi.mock('../src/api/customers', () => ({
  customerApi: {
    list: vi.fn(),
    summary: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

const customer = {
  id: 1,
  name: 'Acme Buyer',
  email: 'buyer@example.com',
  company: 'Acme',
  status: 'ACTIVE' as const,
  notes: 'Important account',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(customerApi.list).mockResolvedValue({
    records: [customer],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  vi.mocked(customerApi.summary).mockResolvedValue({
    total: 1,
    active: 1,
    inactive: 0,
  });
  vi.mocked(customerApi.create).mockResolvedValue(customer);
  vi.mocked(customerApi.update).mockResolvedValue({
    ...customer,
    status: 'INACTIVE',
  });
  vi.mocked(customerApi.remove).mockResolvedValue({ id: 1, deleted: true });
});

it('[CASE-AC-4] renders summary, filters and creates, edits and deletes customers', async () => {
  const wrapper = mount(CustomerPanel);
  await flushPromises();
  expect(wrapper.text()).toContain('Total 1');
  expect(wrapper.text()).toContain('Active 1');
  expect(wrapper.text()).toContain('Inactive 0');
  expect(wrapper.text()).toContain('Acme Buyer');
  await wrapper.get('#customer-search').setValue('Acme');
  await wrapper.get('#customer-status-filter').setValue('ACTIVE');
  await wrapper.get('form.toolbar').trigger('submit');
  await flushPromises();
  expect(customerApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ query: 'Acme', status: 'ACTIVE' }),
  );

  await wrapper.get('[data-testid="customer-create"]').trigger('click');
  await wrapper.get('#customer-name').setValue('New Buyer');
  await wrapper.get('#customer-email').setValue('new@example.com');
  await wrapper.get('#customer-company').setValue('New Co');
  await wrapper.get('#customer-status').setValue('ACTIVE');
  await wrapper.get('#customer-notes').setValue('Created from test');
  await wrapper.get('#customer-form').trigger('submit');
  await flushPromises();
  expect(customerApi.create).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'New Buyer', email: 'new@example.com' }),
  );

  await wrapper.get('[data-testid="customer-edit"]').trigger('click');
  await wrapper.get('#customer-status').setValue('INACTIVE');
  await wrapper.get('#customer-form').trigger('submit');
  await flushPromises();
  expect(customerApi.update).toHaveBeenCalled();

  await wrapper.get('[data-testid="customer-delete"]').trigger('click');
  await flushPromises();
  expect(customerApi.remove).toHaveBeenCalledWith(1);
});
