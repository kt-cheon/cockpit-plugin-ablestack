/**
 * File Name : index.js
 * Date Created : 2023.04.25
 * Writer : 배태주
 * Description : index.html에서 출력할 메인 페이지를 분기하는 스크립트
 **/

const cockpitDarkClasses = [
  "pf-v6-theme-dark",
  "pf-v5-theme-dark",
  "pf-theme-dark",
  "theme-dark",
  "pf-m-dark"
];

function getParentDocument() {
  try {
    if (window.parent && window.parent !== window) {
      return window.parent.document;
    }
  } catch (e) {
    return null;
  }
  return null;
}

function hasDarkTheme(doc) {
  if (!doc) {
    return false;
  }
  const roots = [doc.documentElement, doc.body].filter(Boolean);
  for (const root of roots) {
    for (const cls of cockpitDarkClasses) {
      if (root.classList.contains(cls)) {
        return true;
      }
    }
    const dataTheme = root.getAttribute && root.getAttribute("data-theme");
    if (dataTheme && dataTheme.toLowerCase() === "dark") {
      return true;
    }
  }
  return false;
}

function applyThemeFromCockpit() {
  const parentDoc = getParentDocument();
  if (parentDoc) {
    document.documentElement.classList.toggle("pf-v6-theme-dark", hasDarkTheme(parentDoc));
    return;
  }
  if (hasDarkTheme(document)) {
    document.documentElement.classList.add("pf-v6-theme-dark");
    return;
  }
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    document.documentElement.classList.add("pf-v6-theme-dark");
  } else {
    document.documentElement.classList.remove("pf-v6-theme-dark");
  }
}

function observeThemeChanges() {
  const parentDoc = getParentDocument();
  const target = parentDoc ? parentDoc.documentElement || parentDoc.body : document.documentElement;
  if (!target || typeof MutationObserver === "undefined") {
    return;
  }
  const observer = new MutationObserver(function () {
    applyThemeFromCockpit();
  });
  observer.observe(target, { attributes: true, attributeFilter: ["class", "data-theme"] });
}

// document.ready 영역 시작
$(document).ready(function(){
  applyThemeFromCockpit();
  observeThemeChanges();

  const permission = cockpit.permission({ admin: true });
  let loading = false;
  let loaded = false;
  let generation = 0;

  function showPage(page, current) {
    return $.get(page).then(function (content) {
      if (current === generation) $('#index-page').html(content);
    });
  }

  function updateAccess() {
    if (permission.allowed !== true) {
      generation++;
      if (loaded) {
        // Clear feature timers and pending callbacks when administrator access is dropped.
        window.location.reload();
        return;
      }
      loading = false;
      if (permission.allowed === false) {
        showPage("main-glue-no-permission.html", generation).catch(function () {
          if (permission.allowed !== true) $('#index-page').text("Cockpit에서 관리자 접근을 활성화해주세요.");
        });
      } else {
        $('#index-page').text("관리자 권한을 확인하고 있습니다.");
      }
      return;
    }
    if (loading || loaded) return;
    const current = ++generation;
    loading = true;
    Promise.all([ablestack.spawn(["hostname"]), checkOSType()])
      .then(function (values) {
        if (current !== generation || permission.allowed !== true) return;
        loaded = true;
        return showPage(values[0].trim().includes("scvm") ? "main-glue.html" : "main.html", current);
      })
      .catch(function (error) {
        if (current !== generation) return;
        loading = false;
        loaded = false;
        $('#index-page').text("ABLESTACK 초기 정보를 읽지 못했습니다: " + (error.message || error));
      });
  }

  permission.addEventListener("changed", updateAccess);
  updateAccess();
});

/**
 * Meathod Name : checkOSType
 * Date Created : 2024.09.11
 * Writer : 정민철
 * Description : 운영 체재를 sessionstroage에 저장하는 함수
 * History : 2024.09.11 수정
 */
function checkOSType() {
  return ablestack.file('/usr/share/cockpit/ablestack/tools/properties/cluster.json').read().then(function(data) {
    const config = JSON.parse(data).clusterConfig;
    sessionStorage.setItem('os_type', config.type);
    sessionStorage.setItem("iscsi_check", config.iscsi_storage);
  });
}
