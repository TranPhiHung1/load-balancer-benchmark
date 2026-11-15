function officialBatchId(){return results.defaultBatchId || results.batches.find(b=>b.pinned)?.id || 'run-20261108-214448-206-b8432507';}
let pendingTrashId=null, managementBusy=false, trashBatches=[];
function updateBatchActions() {
  const batch=results.batches.find(b=>b.id===$('batch').value);
  const runningJob=(typeof benchmarkBusy!=='undefined' && benchmarkBusy) || (typeof benchmarkSubmitting!=='undefined' && benchmarkSubmitting);
  $('trash-batch').disabled=managementBusy || runningJob || !!batch?.isProtected || !batch?.canTrash;
  $('trash-batch').title=batch?.isProtected ? batch.trashReason : runningJob ? 'Chờ benchmark hoàn tất' : batch?.trashReason || 'Chỉ đợt hoàn tất do Dashboard tạo mới được chuyển vào thùng rác';
  const item=trashBatches.find(b=>b.id===$('trash-selection').value);
  $('restore-batch').disabled=managementBusy || runningJob || !item?.canRestore;
  $('refresh-trash').disabled=managementBusy;
}
async function refreshTrash() {
  try {
    const data=await api('/api/results/trash');
    const selected=$('trash-selection').value;
    trashBatches=data.batches;
    $('trash-selection').innerHTML=trashBatches.length ? trashBatches.map(b=>`<option value="${esc(b.id)}">${esc(b.id)}</option>`).join('') : '<option value="">Thùng rác trống</option>';
    if(trashBatches.some(b=>b.id===selected))$('trash-selection').value=selected;
    updateBatchActions();
  }catch(e){$('manage-message').textContent='Không đọc được thùng rác: '+e.message;}
}
function openTrashDialog() {
  if($('trash-batch').disabled)return;
  const batch=results.batches.find(b=>b.id===$('batch').value);
  if(!batch?.canTrash || batch.isProtected)return;
  pendingTrashId=batch.id;
  $('trash-confirm-id').textContent=pendingTrashId;
  $('trash-dialog-message').textContent='';
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
    $('manage-message').textContent=`Đã chuyển ${id} vào thùng rác. `+(refreshed && $('batch').value===official ? 'Đã chọn lại đợt benchmark chính thức; có thể khôi phục ở mục Thùng rác.' : 'Hãy làm mới danh sách để xem đợt benchmark chính thức; có thể khôi phục ở mục Thùng rác.');
  }catch(e){$('manage-message').textContent='Không thể chuyển vào thùng rác: '+e.message;$('trash-dialog-message').textContent=e.message;}
  finally{managementBusy=false;$('confirm-trash').disabled=false;$('cancel-trash').disabled=false;updateBatchActions();}
}
async function restoreBatch() {
  if($('restore-batch').disabled || managementBusy)return;
  const id=$('trash-selection').value;
  managementBusy=true;updateBatchActions();
  try {
    await api('/api/results/restore',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Action':'results'},body:JSON.stringify({id,confirmed:true})});
    const refreshed=await refreshResults(id);await refreshTrash();
    $('manage-message').textContent=`Đã khôi phục ${id}; nội dung kết quả giữ nguyên.`+(refreshed ? '' : ' Hãy làm mới danh sách kết quả.');
  }catch(e){$('manage-message').textContent='Không thể khôi phục: '+e.message;}
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
