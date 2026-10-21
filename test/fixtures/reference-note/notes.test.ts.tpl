import { afterEach, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import NotesPanel from '../src/components/NotesPanel.vue';
import { noteApi } from '../src/api/notes';
import * as common from '../src/api/request';

afterEach(()=>vi.restoreAllMocks());
it('[AC-102] typed Note API preserves GET and POST JSON contracts',async()=>{
  const read=vi.spyOn(common,'request').mockResolvedValue({records:[]});
  const write=vi.spyOn(common,'mutate').mockResolvedValue({id:1,deleted:true});
  await noteApi.list(); await noteApi.create({title:'one',completed:false});
  await noteApi.update(1,{title:'two',completed:false});await noteApi.remove(1);
  expect(read).toHaveBeenCalledWith('/api/notes');
  expect(write).toHaveBeenCalledWith('/api/notes/update',{id:1,title:'two',completed:false});
  expect(write).toHaveBeenCalledWith('/api/notes/delete',{id:1});
});
it('[AC-102] Note page creates, updates, confirms deletion and respects read-only role',async()=>{
  const note={id:1,title:'Note',completed:false};
  vi.spyOn(noteApi,'list').mockResolvedValue({records:[note],total:1,page:1,pageSize:20});
  const create=vi.spyOn(noteApi,'create').mockResolvedValue(note);
  const update=vi.spyOn(noteApi,'update').mockResolvedValue(note);
  const remove=vi.spyOn(noteApi,'remove').mockResolvedValue({deleted:true});
  const wrapper=mount(NotesPanel,{props:{admin:true}});await flushPromises();
  const click=async(label:string)=>{await wrapper.findAll('button').find(button=>button.text()===label)!.trigger('click');await flushPromises();};
  await wrapper.get('form').trigger('submit');expect(wrapper.text()).toContain('Enter a note title');
  await wrapper.get('input').setValue('New');await wrapper.get('form').trigger('submit');await flushPromises();expect(create).toHaveBeenCalled();
  await click('Edit note');await wrapper.get('input').setValue('Changed');await wrapper.get('form').trigger('submit');await flushPromises();expect(update).toHaveBeenCalledWith(1,{title:'Changed',completed:false});
  await click('Delete note');await click('Cancel note deletion');expect(remove).not.toHaveBeenCalled();
  await click('Delete note');await click('Confirm note deletion');expect(remove).toHaveBeenCalledWith(1);
  vi.mocked(noteApi.create).mockRejectedValueOnce(new Error('Retry'));await wrapper.get('input').setValue('Keep');await wrapper.get('form').trigger('submit');await flushPromises();expect(wrapper.text()).toContain('Retry');
  await wrapper.setProps({admin:false});expect(wrapper.find('form').exists()).toBe(false);wrapper.unmount();
});
