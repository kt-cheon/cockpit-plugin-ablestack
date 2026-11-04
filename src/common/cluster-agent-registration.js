/* Shared registration downloads for cluster preparation and saved configuration files. */
function renderClusterAgentRegistrationDownloads(selector, hosts) {
  const downloads = $(selector).empty();
  if (!hosts.length) {
    downloads.text('생성된 호스트 통신 등록 파일이 없습니다.');
    return;
  }
  hosts.forEach(function (host) {
    const row = $('<div>').appendTo(downloads);
    $('<button>', {type: 'button', class: 'pf-v6-c-button pf-m-link'}).text(host + ' 통신 등록 파일 다운로드')
      .on('click', async function () {
        this.disabled = true;
        try {
          const content = await ablestack.spawn(['python3', '/usr/libexec/ablestack/node-agent/cluster_enrollment.py',
            'export', '--host', host], {err: 'message'});
          const url = URL.createObjectURL(new Blob([content], {type: 'application/json'}));
          const link = document.createElement('a');
          link.href = url;
          link.download = host + '.cube-agent.json';
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        } catch (error) {
          alert('통신 등록 파일 다운로드에 실패했습니다: ' + error.message);
        } finally {
          this.disabled = false;
        }
      }).appendTo(row);
  });
}

async function refreshClusterAgentRegistrationDownloads(selector) {
  const downloads = $(selector).empty().text('호스트 통신 등록 파일을 확인 중입니다.');
  try {
    const response = await ablestack.spawn(['python3', '/usr/libexec/ablestack/node-agent/cluster_enrollment.py',
      'list-exports'], {err: 'message'});
    renderClusterAgentRegistrationDownloads(selector, JSON.parse(response).exports);
  } catch (error) {
    downloads.empty().text('호스트 통신 등록 파일을 조회하지 못했습니다: ' + error.message);
  }
}
