"use strict";

// UI only. engine.js owns the upstream ZIP/WASM loader and virtual filesystem.
(() => {
  const $ = (id) => document.getElementById(id);
  const shell = $("game-shell");
  const canvas = $("ikemen-canvas");
  const overlay = $("overlay");
  const form = $("player-form");
  const startButton = $("start-button");
  const fields = [$("player-one"), $("player-two")];
  const loading = $("loading-panel");
  const track = $("progress-track");
  const bar = $("progress-bar");
  const status = $("status");
  const progressLabel = $("progress-label");
  const retry = $("retry-button");
  const guide = $("controls-guide");
  const guideButton = $("controls-toggle");
  const storageKey = "pangyo-fight:players";
  const networkNameKey = "pangyo-fight:network-name";
  let state = "idle";
  let toastTimer;
  let session = null;
  let networkEpoch = 0;

  function closeNetworkSession() {
    networkEpoch += 1;
    const previous = session;
    session = null;
    previous?.close();
  }

  const cleanName = (value, side) => Array.from(String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim()).slice(0, 16).join("") || `${side + 1}P 도전자`;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (Array.isArray(saved)) fields.forEach((field, side) => { field.value = cleanName(saved[side], side); });
  } catch { /* A restricted school browser can still play without storage. */ }

  function fitFrame() {
    const host = $("stage-host");
    const computed = getComputedStyle(host);
    const width = host.clientWidth - parseFloat(computed.paddingLeft) - parseFloat(computed.paddingRight);
    const height = host.clientHeight - parseFloat(computed.paddingTop) - parseFloat(computed.paddingBottom);
    const fitted = Math.max(0, Math.min(width, height * 16 / 9));
    $("stage").style.width = `${fitted}px`;
    $("stage").style.height = `${fitted * 9 / 16}px`;
  }
  new ResizeObserver(fitFrame).observe($("stage-host"));
  window.addEventListener("resize", fitFrame);

  function setState(next) {
    state = next;
    document.body.dataset.state = next;
    requestAnimationFrame(fitFrame);
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").hidden = false;
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, 4500);
  }
  function progress(update = {}) {
    if (state !== "loading") return;
    if (typeof update === "string") update = { message: update };
    if (update.message) status.textContent = update.message;
    const fraction = Number.isFinite(update.fraction) ? update.fraction
      : Number.isFinite(update.total) && update.total > 0 ? update.loaded / update.total : null;
    if (fraction !== null && Number.isFinite(fraction)) {
      const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
      track.classList.remove("is-indeterminate");
      track.setAttribute("aria-valuenow", String(percent));
      bar.style.width = `${percent}%`;
      progressLabel.textContent = `${percent}%`;
    } else {
      track.classList.add("is-indeterminate");
      track.removeAttribute("aria-valuenow");
      progressLabel.textContent = "준비 중";
    }
  }
  function ready() {
    if (state !== "loading") return;
    setState("playing");
    overlay.classList.add("hidden");
    canvas.focus({ preventScroll: true });
  }
  function failed(error) {
    if (state === "error") return;
    const wasPlaying = state === "playing";
    const wasNetwork = Boolean(session);
    setState("error");
    closeNetworkSession();
    overlay.classList.remove("hidden");
    overlay.classList.remove("network-mode");
    $("network-panel").hidden = true;
    form.hidden = true;
    loading.hidden = false;
    $("loading-title").textContent = wasPlaying ? "게임이 중단됐어요" : "시작하지 못했어요";
    status.textContent = wasNetwork ? "페이지를 새로고침한 뒤 친구와 다시 연결해 주세요." : "페이지를 새로고침해 다시 시도해 주세요.";
    track.hidden = true;
    progressLabel.hidden = true;
    $("loading-note").hidden = true;
    $("error").textContent = error?.message || String(error || "게임을 시작하는 중 오류가 발생했습니다.");
    $("error").style.display = "block";
    $("error-details").hidden = false;
    retry.hidden = false;
    retry.textContent = "다시 시도";
    retry.focus({ preventScroll: true });
  }
  function exited(code = 0) {
    if (state === "error" || state === "exited") return;
    if (code !== 0) { failed(new Error(`게임 종료 코드: ${code}`)); return; }
    setState("exited");
    closeNetworkSession();
    overlay.classList.remove("hidden");
    overlay.classList.remove("network-mode");
    $("network-panel").hidden = true;
    form.hidden = true;
    loading.hidden = false;
    $("loading-title").textContent = "대전을 마쳤어요";
    status.textContent = "다시 시작하면 플레이어 이름을 바꿀 수 있어요.";
    track.hidden = true;
    progressLabel.hidden = true;
    $("loading-note").hidden = true;
    retry.hidden = false;
    retry.textContent = "다시 시작";
    retry.focus({ preventScroll: true });
  }

  function startGame(players, network) {
    if (state !== "idle" && state !== "connecting") return;
    try {
      if (network && session) localStorage.setItem(networkNameKey, session.nickname);
      else localStorage.setItem(storageKey, JSON.stringify(players));
    } catch { /* Optional preference. */ }
    fields.forEach((field) => { field.disabled = true; });
    startButton.disabled = true;
    $("network-panel").hidden = true;
    overlay.classList.remove("network-mode");
    form.hidden = true;
    loading.hidden = false;
    setState("loading");
    progress({ message: "게임 파일을 불러오는 중..." });
    if (typeof window.PangyoEngine?.start !== "function") {
      failed(new Error("게임 로더를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요."));
      return;
    }
    try {
      Promise.resolve(window.PangyoEngine.start({ canvas, players, network, onProgress: progress, onReady: ready, onError: failed, onExit: exited })).catch(failed);
    } catch (error) { failed(error); }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state !== "idle") return;
    startGame(fields.map((field, side) => cleanName(field.value, side)));
  });
  retry.addEventListener("click", () => location.reload());

  function networkStatus(message) { $("network-status").textContent = message; }
  function networkError(error) {
    const source = error?.message || String(error);
    let message = "연결하지 못했어요. 코드를 확인하고 다시 시도해 주세요.";
    if (/same game build|build.*mismatch/i.test(source)) message = "게임 버전이 달라요. 둘 다 페이지를 새로고침한 뒤 다시 방을 만들어 주세요.";
    else if (/Wrong connection code type/i.test(source)) message = "코드 종류가 달라요. 방을 만든 사람은 친구의 응답 코드를, 참가하는 사람은 방의 연결 코드를 넣어 주세요.";
    else if (/Invalid connection code|large|gzip|decompress|JSON|atob/i.test(source)) message = "연결 코드가 올바르지 않아요. PGRTC1.부터 끝까지 다시 복사해 주세요.";
    else if (/timed out|timeout|closed|channel|peer connection/i.test(source)) message = "상대와 연결되지 않았어요. 둘 다 돌아가서 새 코드를 만들고, 같은 Wi-Fi나 다른 네트워크에서도 확인해 주세요.";
    else if (/manifest|buildId|fetch|module/i.test(source)) message = "연결 기능을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
    else if (/RTCPeerConnection|CompressionStream/i.test(source)) message = "이 브라우저에서는 기기 간 연결을 사용할 수 없어요. 최신 Chrome에서 열어 주세요.";
    $("network-error").textContent = message;
    $("network-error").hidden = false;
    networkStatus("");
  }
  function clearNetworkError() { $("network-error").hidden = true; $("network-error").textContent = ""; }
  function resetNetwork() {
    closeNetworkSession();
    clearNetworkError();
    networkStatus("");
    $("network-choice").hidden = false;
    $("network-exchange").hidden = true;
    $("network-share").hidden = true;
    $("network-code-form").hidden = false;
    $("network-in").value = "";
    $("network-out").value = "";
    for (const id of ["network-host", "network-guest", "network-connect", "network-in"]) $(id).disabled = false;
  }
  $("network-open").addEventListener("click", () => {
    if (state !== "idle") return;
    resetNetwork();
    $("network-name").value = fields[0].value;
    try { $("network-name").value = localStorage.getItem(networkNameKey) || fields[0].value; } catch { /* Optional preference. */ }
    $("network-panel").hidden = false;
    form.hidden = true;
    overlay.classList.add("network-mode");
    setState("connecting");
    $("network-name").focus({ preventScroll: true });
  });
  $("network-back").addEventListener("click", () => {
    if (state !== "connecting") return;
    resetNetwork();
    $("network-panel").hidden = true;
    form.hidden = false;
    overlay.classList.remove("network-mode");
    setState("idle");
    $("network-open").focus({ preventScroll: true });
  });
  async function chooseRole(role) {
    if (state !== "connecting" || session) return;
    const epoch = ++networkEpoch;
    clearNetworkError();
    $("network-host").disabled = true;
    $("network-guest").disabled = true;
    networkStatus("연결을 준비하고 있어요...");
    let pending;
    try {
      const [{ ManualIkemenSession }, response] = await Promise.all([
        import("./runtime/manual-session.mjs"),
        fetch("./assets/game-manifest.json", { cache: "no-cache" }),
      ]);
      if (!response.ok) throw new Error("manifest unavailable");
      const manifest = await response.json();
      if (!manifest.buildId) throw new Error("buildId unavailable");
      if (epoch !== networkEpoch) return;
      pending = new ManualIkemenSession({ role, buildId: manifest.buildId, nickname: cleanName($("network-name").value, role === "host" ? 0 : 1), iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      session = pending;
      pending.bridge.addEventListener("close", () => {
        if (session !== pending) return;
        if (state === "playing" || state === "loading") failed(new Error("상대와의 연결이 끊겼어요. 페이지를 새로고침한 뒤 다시 연결해 주세요."));
        else if (state === "connecting") networkError(new Error(pending.bridge.closeReason));
      });
      $("network-choice").hidden = true;
      $("network-exchange").hidden = false;
      if (role === "host") {
        networkStatus("친구에게 보낼 코드를 만들고 있어요...");
        const code = await pending.createOfferCode();
        if (epoch !== networkEpoch) return;
        $("network-out").value = code;
        $("network-out-label").textContent = "친구에게 보낼 연결 코드";
        $("network-share-help").textContent = "이 코드를 보내고, 친구가 만든 응답 코드를 아래에 넣어 주세요.";
        $("network-share").hidden = false;
        $("network-in-label").textContent = "친구에게 받은 응답 코드";
        $("network-connect").textContent = "연결하고 게임 시작";
      } else {
        $("network-in-label").textContent = "방을 만든 친구의 연결 코드";
        $("network-connect").textContent = "응답 코드 만들기";
        $("network-in").focus({ preventScroll: true });
      }
      networkStatus("");
    } catch (error) {
      if (epoch !== networkEpoch) { pending?.close(); return; }
      session = null;
      pending?.close();
      $("network-choice").hidden = false;
      $("network-exchange").hidden = true;
      $("network-host").disabled = false;
      $("network-guest").disabled = false;
      networkError(error);
    }
  }
  $("network-host").addEventListener("click", () => chooseRole("host"));
  $("network-guest").addEventListener("click", () => chooseRole("guest"));
  $("network-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("network-out").value);
      toast("연결 코드를 복사했어요. 친구에게 보내 주세요.");
    } catch {
      $("network-out").focus();
      $("network-out").select();
      toast("선택된 코드를 Ctrl+C로 복사해 주세요.");
    }
  });
  $("network-code-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const active = session;
    const epoch = networkEpoch;
    if (!active || state !== "connecting" || $("network-connect").disabled) return;
    const code = $("network-in").value.trim();
    if (!code) { networkError(new Error("Invalid connection code")); $("network-in").focus(); return; }
    clearNetworkError();
    $("network-connect").disabled = true;
    $("network-in").disabled = true;
    networkStatus("연결 코드를 확인하고 있어요...");
    try {
      if (active.role === "guest") {
        const answer = await active.acceptOfferCode(code);
        if (epoch !== networkEpoch) return;
        $("network-out").value = answer;
        $("network-out-label").textContent = "친구에게 보낼 응답 코드";
        $("network-share-help").textContent = "방을 만든 친구에게 보내 주세요. 친구가 코드를 넣으면 게임을 시작해요.";
        $("network-share").hidden = false;
        $("network-code-form").hidden = true;
        networkStatus("친구의 연결을 기다리고 있어요. 연결되면 각자 1P 키로 플레이해요.");
      } else {
        await active.acceptAnswerCode(code);
        if (epoch !== networkEpoch) return;
        networkStatus("친구와 연결 중이에요. 연결되면 각자 1P 키로 플레이해요.");
      }
      await active.attachEngine(180000);
      if (epoch !== networkEpoch) return;
      const players = active.role === "host" ? [active.nickname, active.peerNickname] : [active.peerNickname, active.nickname];
      document.querySelector(".quick-controls").textContent = "온라인 대전 · 각자 1P 키: WASD + FGH / VBN";
      startGame(players.map(cleanName), { role: active.role });
    } catch (error) {
      if (epoch !== networkEpoch) return;
      // A failed code can be edited. Once SDP was accepted, retry with a fresh peer.
      if (active.bridge.closed || active.pc.remoteDescription) resetNetwork();
      $("network-connect").disabled = false;
      $("network-in").disabled = false;
      networkError(error);
    }
  });

  function toggleGuide(open) {
    guide.hidden = !open;
    guideButton.setAttribute("aria-expanded", String(open));
    requestAnimationFrame(fitFrame);
  }
  guideButton.addEventListener("click", () => toggleGuide(guide.hidden));
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !guide.hidden) {
      toggleGuide(false);
      event.stopImmediatePropagation();
      if (state === "playing") canvas.focus({ preventScroll: true });
    }
  });
  canvas.addEventListener("pointerdown", () => canvas.focus({ preventScroll: true }));

  $("fullscreen-button").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (shell.requestFullscreen) await shell.requestFullscreen({ navigationUI: "hide" });
      else { toast("이 브라우저에서는 전체화면 버튼을 사용할 수 없어요."); return; }
      if (state === "playing") canvas.focus({ preventScroll: true });
    } catch { toast("전체화면 전환이 허용되지 않았어요. 창에서도 그대로 플레이할 수 있어요."); }
  });
  document.addEventListener("fullscreenchange", () => {
    $("fullscreen-label").textContent = document.fullscreenElement ? "전체화면 닫기" : "전체화면";
    requestAnimationFrame(fitFrame);
  });
  if (new URLSearchParams(location.search).get("debug") === "1") {
    const output = $("debug-fps");
    output.hidden = false;
    const updateFPS = () => {
      const fps = window.PangyoEngine?.getDiagnostics?.().fps;
      output.textContent = Number.isFinite(fps) ? `FPS ${fps.toFixed(1)}` : "FPS —";
    };
    updateFPS();
    setInterval(updateFPS, 1000);
  }
  fitFrame();
})();
