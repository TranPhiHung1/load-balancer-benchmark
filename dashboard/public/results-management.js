function officialBatchId(){return results.defaultBatchId || results.batches.find(b=>b.pinned)?.id || 'run-20261108-214448-206-b8432507';}
let pendingTrashId=null, managementBusy=false, trashBatches=[];
function updateBatchActions() {
  const batch=results.batches.find(b=>b.id===$('batch').value);
  const runningJob=(typeof benchmarkBusy!=='undefined' && benchmarkBusy) || (typeof benchmarkSubmitting!=='undefined' && benchmarkSubmitting);
  $('trash-batch').disabled=managementBusy || runningJob || !!batch?.isProtected || !batch?.canTrash;
  $('trash-batch').title=detail(batch?.isProtected ? batch.trashReason : runningJob ? 'Chờ benchmark hoàn tất' : batch?.trashReason || 'Chỉ đợt hoàn tất do Dashboard tạo mới được chuyển vào thùng rác');
  const item=trashBatches.find(b=>b.id===$('trash-selection').value);
  $('restore-batch').disabled=managementBusy || runningJob || !item?.canRestore;
  $('refresh-trash').disabled=managementBusy;
}
function renderTrash() {
  const selected=$('trash-selection').value;
  $('trash-selection').innerHTML=trashBatches.length ? trashBatches.map(b=>`<option value="${esc(b.id)}">${esc(b.id)}</option>`).join('') : `<option value="">${tr('Thùng rác trống')}</option>`;
  if(trashBatches.some(b=>b.id===selected))$('trash-selection').value=selected;
  updateBatchActions();
}
onLanguage(renderTrash);
async function refreshTrash() {
  try {
    const data=await api('/api/results/trash');
    trashBatches=data.batches;
    renderTrash();
  }catch(e){setMessage('manage-message', () => tr('Không đọc được thùng rác: ')+detail(e.message));}
}
function openTrashDialog() {
  if($('trash-batch').disabled)return;
  const batch=results.batches.find(b=>b.id===$('batch').value);
  if(!batch?.canTrash || batch.isProtected)return;
  pendingTrashId=batch.id;
  $('trash-confirm-id').textContent=pendingTrashId;
  setMessage('trash-dialog-message', () => '');
  $('trash-confirm').showModal();
}
function cancelTrashDialog() {
  if(managementBusy)return;
  pendingTrashId=null;$('trash-confirm').close();
}
async function confirmTrash() {
  if(!pendingTrashId || managementBusy)return;
  const id=pendingTrashId;
  managementBusy=true;$('confirm-trash').disabled=true;$('cancel-trash').disabled=true;updateBatchActions();
  try {
    await api('/api/results/trash',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Action':'results'},body:JSON.stringify({id,confirmed:true})});
    pendingTrashId=null;$('trash-confirm').close();
    const official=officialBatchId();
    const refreshed=await refreshResults(official);await refreshTrash();
    const selectedOfficial = refreshed && $('batch').value === official;
    setMessage('manage-message', () => tr`Đã chuyển ${id} vào thùng rác. ` + tr(selectedOfficial ? 'Đã chọn lại đợt benchmark chính thức; có thể khôi phục ở mục Thùng rác.' : 'Hãy làm mới danh sách để xem đợt benchmark chính thức; có thể khôi phục ở mục Thùng rác.'));
  }catch(e){setMessage('manage-message', () => tr('Không thể chuyển vào thùng rác: ')+detail(e.message));setMessage('trash-dialog-message', () => detail(e.message));}
  finally{managementBusy=false;$('confirm-trash').disabled=false;$('cancel-trash').disabled=false;updateBatchActions();}
}
async function restoreBatch() {
  if($('restore-batch').disabled || managementBusy)return;
  const id=$('trash-selection').value;
  managementBusy=true;updateBatchActions();
  try {
    await api('/api/results/restore',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Action':'results'},body:JSON.stringify({id,confirmed:true})});
    const refreshed=await refreshResults(id);await refreshTrash();
    setMessage('manage-message', () => tr`Đã khôi phục ${id}; nội dung kết quả giữ nguyên.` + (refreshed ? '' : tr(' Hãy làm mới danh sách kết quả.')));
  }catch(e){setMessage('manage-message', () => tr('Không thể khôi phục: ')+detail(e.message));}
  finally{managementBusy=false;updateBatchActions();}
}
$('trash-batch').onclick=openTrashDialog;
$('cancel-trash').onclick=cancelTrashDialog;
$('confirm-trash').onclick=confirmTrash;
$('restore-batch').onclick=restoreBatch;
$('refresh-trash').onclick=refreshTrash;
$('trash-selection').onchange=updateBatchActions;
$('trash-confirm').addEventListener('cancel',event=>{if(managementBusy)event.preventDefault();else pendingTrashId=null;});
updateBatchActions();
refreshTrash();
