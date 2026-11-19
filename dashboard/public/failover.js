(() => {
  const backendIds = ['backend-1', 'backend-2'];
  const dockerLabels = {
    running: 'Đang chạy', exited: 'Đã dừng', created: 'Chưa khởi động', missing: 'Không tìm thấy',
    paused: 'Tạm dừng', restarting: 'Đang khởi động lại', dead: 'Không hoạt động', removing: 'Đang xóa', unknown: 'Chưa xác định',
  };
  const healthLabels = { healthy: 'Healthy', unhealthy: 'Unhealthy', starting: 'Đang kiểm tra' };
  const timeline = [];
  const observations = [];
  let snapshot, pending = false, error = '', selectedObservation = -1;
  const balancer = () => $('health-balancer').value;
  const backend = () => $('health-backend').value;
  const isStopped = state => ['created', 'exited'].includes(state?.docker);
  const findRestore = () => {
    const stopped = snapshot?.backends.filter(isStopped) || [];
    return stopped.find(entry => entry.name === backend()) || stopped[0];
  };
  const isSuccessful = row => row?.status === 200 && !row.error && backendIds.includes(row.backend);
  const respondsAs = (row, id) => isSuccessful(row) && row.backend === id;
  const httpText = row => {
    if (!row) return tr('Chưa xác định');
    const status = row.status ? 'HTTP ' + row.status : tr('Không có phản hồi');
    return row.error ? status + ' · ' + detail(row.error) : status;
  };
  function availability(row, expected) {
    if (!row || (row.status === 200 && (!isSuccessful(row) || (expected && row.backend !== expected)))) return 'Unknown';
    return isSuccessful(row) ? 'Online' : 'Offline';
  }
  const availabilityLabel = key => tr({ Online: 'Đang hoạt động', Offline: 'Không hoạt động', Unknown: 'Chưa xác định' }[key]);
  const httpLabel = (row, state) => row ? availabilityLabel(state) + ' · ' + httpText(row) : availabilityLabel(state);
  const dateText = value => new Date(value).toLocaleTimeString(dateLocale());
  function render() {
    const restoreTarget = findRestore();
    const blockedByRun = Boolean(snapshot?.benchmarkBusy);
    $('health-lb-name').textContent = names[balancer()];
    const lbState = availability(snapshot?.http);
    $('health-lb-http').textContent = httpLabel(snapshot?.http, lbState);
    $('health-lb-http').className = lbState;
    $('health-backends').innerHTML = backendIds.map(id => {
      const state = snapshot?.backends.find(item => item.name === id);
      const dockerStatus = tr(dockerLabels[state?.docker] || 'Chưa xác định');
      const health = state?.containerHealth ? tr(healthLabels[state.containerHealth] || 'Chưa xác định') : tr('Không có dữ liệu kiểm tra');
      const httpClass = availability(state?.http, id);
      return `<div class="flow-node"><strong>${names[id]}</strong>
        <small>Docker: ${esc(dockerStatus)}</small><small class="${httpClass}">${esc(httpLabel(state?.http, httpClass))}</small>
        <small>Docker HEALTHCHECK: ${esc(health)}</small>
        ${state?.error ? `<small class="Offline">${esc(detail(state.error))}</small>` : ''}</div>`;
    }).join('');
    $('health-status').textContent = snapshot ? tr`Quan sát lúc ${dateText(snapshot.checkedAt)}. Trạng thái nội bộ của Load Balancer: không có nguồn đo được cấu hình.` : '';
    $('health-message').textContent = error ? detail(error) : pending ? tr('Đang thực hiện thao tác…')
      : blockedByRun ? tr('Benchmark đang chạy hoặc giữ khóa. Vẫn có thể khôi phục backend.')
        : snapshot?.session ? tr('Phiên failover đang mở. Sau khi khôi phục, hãy kiểm tra lại để mở khóa benchmark.')
          : restoreTarget ? tr`${names[restoreTarget.name]} đang dừng và có thể được khôi phục.` : '';
    for (const id of ['health-refresh', 'health-initial', 'health-recovery', 'health-backend', 'health-balancer']) $(id).disabled = pending;
    for (const id of ['health-send-10', 'health-send-20']) $(id).disabled = pending || blockedByRun;
    $('health-stop').disabled = pending || !snapshot || blockedByRun || snapshot.session ||
      !snapshot.backends.every(entry => entry.docker === 'running' && respondsAs(entry.http, entry.name));
    $('health-restore').disabled = pending || !restoreTarget;
    $('health-restore').textContent = restoreTarget ? tr`Khôi phục ${names[restoreTarget.name]}` : tr('Khôi phục backend');
    const picker = $('health-observation');
    picker.disabled = observations.length === 0;
    picker.innerHTML = observations.map((entry, i) => `<option value="${i}">${esc(names[entry.balancer])} · ${esc(dateText(entry.at))} · ${entry.rows.length}</option>`).join('');
    picker.value = String(selectedObservation);
    const observation = observations[selectedObservation];
    const rows = observation?.rows || [];
    const passed = rows.filter(isSuccessful).length;
    $('health-summary').textContent = observation ? tr`${names[observation.balancer]} · Thành công: ${passed}/${rows.length} · Lỗi: ${rows.length - passed} · ${dateText(observation.at)}` : tr('Không có dữ liệu.');
    $('health-rows').innerHTML = rows.map(row => {
      const result = names[row.backend] || 'N/A';
      return `<tr><td>${row.number}</td><td>${row.status ?? 'N/A'}</td><td class="${isSuccessful(row) ? 'PASS' : 'FAIL'}">${esc(result)}${row.error ? ' · ' + esc(detail(row.error)) : ''}</td><td>${fmt(row.ms,2)}</td></tr>`;
    }).join('');
    $('health-timeline').innerHTML = timeline.slice().reverse().map(event =>
      `<li><time datetime="${esc(event.at)}">${esc(dateText(event.at))}</time><span>${esc(event.describe())}</span></li>`).join('');
  }
  function addEvent(describe, at = new Date().toISOString()) {
    timeline.push({ describe, at });
    if (timeline.length > 60) timeline.shift();
  }
  const getState = id => api('/api/failover/status?balancer=' + id);
  const post = (action, body) => api('/api/failover/' + action, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard-Action': 'failover' },
    body: JSON.stringify(body),
  });
  async function perform(work, refreshOnError = false) {
    if (pending) return;
    pending = true;
    error = '';
    render();
    try { await work(); }
    catch (failure) {
      error = failure.message;
      addEvent(() => detail(failure.message));
      if (refreshOnError) {
        try { snapshot = await getState(balancer()); }
        catch { snapshot = undefined; }
      }
    } finally { pending = false; render(); }
  }
  function refresh(record) {
    return perform(async () => {
      snapshot = await getState(balancer());
      if (record) {
        const confirmed = snapshot.backends.filter(entry => entry.docker === 'running' && respondsAs(entry.http, entry.name)).length;
        addEvent(() => tr`Kiểm tra ban đầu: ${confirmed}/2 backend đang chạy và trả lời HTTP.`, snapshot.checkedAt);
      }
    }, true);
  }
  function change(action, target) {
    if (!target) return;
    const name = names[target];
    const confirmation = action === 'stop' ? tr`Dừng ${name} trong Docker để quan sát failover?` : tr`Khôi phục ${name} trong Docker?`;
    if (!window.confirm(confirmation)) return;
    return perform(async () => {
      snapshot = await post(action, { balancer: balancer(), backend: target, confirmed: true });
      addEvent(() => action === 'stop' ? tr`Docker đã chấp nhận dừng ${name}.` : tr`Docker đã chấp nhận khôi phục ${name}. Hãy kiểm tra HTTP.`, snapshot.checkedAt);
      void refreshStatus();
    }, true);
  }
  function send(count) {
    return perform(async () => {
      const id = balancer();
      const { rows, observedAt } = await post('requests', { balancer: id, count });
      observations.push({ balancer: id, rows, at: observedAt });
      if (observations.length > 20) observations.shift();
      selectedObservation = observations.length - 1;
      const passed = rows.filter(isSuccessful).length;
      addEvent(() => tr`${names[id]}: ${passed}/${count} yêu cầu thành công.`, observedAt);
    });
  }
  $('health-refresh').onclick = () => refresh(false);
  $('health-initial').onclick = () => refresh(true);
  $('health-stop').onclick = () => change('stop', backend());
  $('health-restore').onclick = () => change('restore', findRestore()?.name);
  $('health-send-10').onclick = () => send(10);
  $('health-send-20').onclick = () => send(20);
  $('health-recovery').onclick = () => perform(async () => {
    snapshot = await post('recovery', { balancer: balancer() });
    addEvent(() => tr('Hai backend đã trả lời HTTP hợp lệ. Benchmark đã được mở khóa.'), snapshot.checkedAt);
    void refreshStatus();
  }, true);
  $('health-backend').onchange = render;
  $('health-observation').onchange = () => { selectedObservation = Number($('health-observation').value); render(); };
  $('health-balancer').onchange = () => { snapshot = undefined; refresh(false); };
  onLanguage(render);
  let previousHash;
  function showTab() {
    const hash = window.location.hash;
    const [route, query] = hash.split('?');
    if (route === '#/demo') {
      const health = new URLSearchParams(query).get('tab') === 'health';
      $('algorithm-panel').hidden = health;
      $('health-panel').hidden = !health;
      $('algorithm-tab').toggleAttribute('aria-current', !health);
      $('health-tab').toggleAttribute('aria-current', health);
      $(health ? 'health-tab' : 'algorithm-tab').setAttribute('aria-current', 'page');
      if (health && hash !== previousHash) void refresh(false);
    }
    previousHash = hash;
  }
  window.addEventListener('hashchange', showTab);
  showTab();
})();
