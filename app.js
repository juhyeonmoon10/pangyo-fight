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
  const movesGuide = $("moves-guide");
  const movesButton = $("moves-toggle");
  const storageKey = "pangyo-fight:players";
  const networkNameKey = "pangyo-fight:network-name";
  let state = "idle";
  let toastTimer;
  let session = null;
  let networkEpoch = 0;
  let networkAbort = null;
  let networkReturnFocus = "network-name";

  function closeNetworkSession() {
    networkEpoch += 1;
    const previous = session;
    session = null;
    networkAbort?.abort();
    networkAbort = null;
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
    const roomMessages = {
      ROOM_INVALID: "방 번호는 숫자 6자리예요. 친구에게 받은 번호를 확인해 주세요.",
      ROOM_NOT_FOUND: "방을 찾을 수 없어요. 번호를 확인하고 친구가 대기실에 있는지 확인해 주세요.",
      ROOM_FULL: "이미 다른 친구가 참가한 방이에요. 새 방을 만들어 주세요.",
      ROOM_EXPIRED: "대기 시간이 지나 방이 닫혔어요. 새 방을 만들어 주세요.",
      ROOM_SERVICE: "방 번호 서비스에 연결할 수 없어요. 다시 시도하거나 ‘연결 코드로 직접 연결’을 선택해 주세요.",
      ROOM_TIMEOUT: "연결 시간이 지났어요. 친구와 새 방에서 다시 시도해 주세요.",
      ROOM_BUILD: "게임 버전이 달라요. 두 사람 모두 새로고침한 뒤 새 방을 만들어 주세요.",
      ROOM_BROWSER: "이 브라우저에서는 온라인 대전을 시작할 수 없어요. 최신 Chrome에서 열어 주세요.",
      ROOM_CLOSED: "방이 닫혔어요. 친구와 새 방에서 다시 시도해 주세요.",
      ROOM_CONNECTION: "두 기기가 연결되지 않았어요. 다른 네트워크에서 새 방을 만들어 주세요.",
    };
    let message = "연결하지 못했어요. 코드를 확인하고 다시 시도해 주세요.";
    const roomMessage = roomMessages[error?.code] || roomMessages[source];
    if (roomMessage) message = roomMessage;
    else if (/same game build|build.*mismatch/i.test(source)) message = "게임 버전이 달라요. 둘 다 페이지를 새로고침한 뒤 다시 방을 만들어 주세요.";
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
  function showNetworkStep(id, title, backLabel) {
    for (const view of ["network-choice", "room-host", "room-guest", "network-exchange"]) {
      $(view).hidden = view !== id;
    }
    $("network-title").textContent = title;
    $("network-back-label").textContent = backLabel;
  }
  function resetNetwork() {
    closeNetworkSession();
    clearNetworkError();
    networkStatus("");
    showNetworkStep("network-choice", "온라인 대전", "돌아가기");
    $("room-share").hidden = true;
    $("room-code").value = "";
    $("room-number").value = "";
    $("room-number").removeAttribute("aria-invalid");
    $("network-share").hidden = true;
    $("network-code-form").hidden = true;
    $("network-in").value = "";
    $("network-out").value = "";
    for (const id of ["room-number", "room-connect", "network-connect", "network-in"]) $(id).disabled = false;
  }
  $("network-open").addEventListener("click", () => {
    if (state !== "idle") return;
    resetNetwork();
    $("manual-options").open = false;
    $("network-name").value = fields[0].value;
    try { $("network-name").value = localStorage.getItem(networkNameKey) || fields[0].value; } catch { /* Optional preference. */ }
    $("network-panel").hidden = false;
    form.hidden = true;
    overlay.classList.add("network-mode");
    setState("connecting");
    $("network-name").focus({ preventScroll: true });
  });
  function networkBack() {
    if (state !== "connecting") return;
    if ($("network-choice").hidden) {
      resetNetwork();
      $(networkReturnFocus).focus();
      return;
    }
    resetNetwork();
    $("network-panel").hidden = true;
    form.hidden = false;
    overlay.classList.remove("network-mode");
    setState("idle");
    $("network-open").focus({ preventScroll: true });
  }
  $("network-back").addEventListener("click", networkBack);
  window.addEventListener("pagehide", () => {
    if (state === "connecting") resetNetwork();
  });

  async function attachAndStart(active, epoch) {
    await active.attachEngine(180000);
    if (epoch !== networkEpoch) return;
    const players = active.role === "host" ? [active.nickname, active.peerNickname] : [active.peerNickname, active.nickname];
    document.querySelector(".quick-controls").textContent = "온라인 대전 · 각자 1P 키: WASD + FGH / VBN";
    startGame(players.map(cleanName), { role: active.role });
  }

  function showGuestEntry() {
    networkReturnFocus = "network-guest";
    showNetworkStep("room-guest", "방 참가", "돌아가기");
    $("room-number").focus();
  }

  function recoverConnection(error, guestEntry) {
    const code = $("room-number").value;
    resetNetwork();
    if (guestEntry) {
      $("room-number").value = code;
      showGuestEntry();
    } else {
      $(networkReturnFocus).focus();
    }
    networkError(error);
  }

  async function beginConnection(role, manual, roomNumber) {
    if (state !== "connecting" || networkAbort) return;
    const epoch = ++networkEpoch;
    const controller = new AbortController();
    networkAbort = controller;
    const guestEntry = !manual && role === "guest";
    networkReturnFocus = (manual ? "manual-" : "network-") + role;
    clearNetworkError();
    if (manual) {
      showNetworkStep("network-exchange", "연결 코드로 직접 연결", "연결 취소");
      networkStatus("연결 코드를 준비하고 있어요…");
    } else if (guestEntry) {
      showNetworkStep("room-guest", "방 참가", "참가 취소");
      $("room-number").disabled = true;
      $("room-connect").disabled = true;
      networkStatus("방을 찾고 있어요…");
    } else {
      showNetworkStep("room-host", "방 만들기", "방 만들기 취소");
      networkStatus("방 번호를 만들고 있어요…");
    }
    $("network-back").focus();
    try {
      const [transport, response] = await Promise.all([
        manual ? import("./runtime/manual-session.mjs") : import("./runtime/room-session.mjs"),
        fetch("./assets/game-manifest.json", { cache: "no-cache", signal: controller.signal }),
      ]);
      if (!response.ok) throw new Error("manifest unavailable");
      const manifest = await response.json();
      if (!manifest.buildId) throw new Error("buildId unavailable");
      if (epoch !== networkEpoch) return;
      const options = { role, buildId: manifest.buildId, nickname: cleanName($("network-name").value, role === "host" ? 0 : 1) };
      const active = manual
        ? new transport.ManualIkemenSession({ ...options, iceServers: [{ urls: "stun:stun.l.google.com:19302" }] })
        : new transport.RoomSession(options);
      session = active;
      const lifecycle = manual ? active.bridge : active;
      lifecycle.addEventListener("close", (event) => {
        if (session !== active) return;
        if (state === "playing" || state === "loading") failed(new Error("상대와의 연결이 끊겼어요. 페이지를 새로고침한 뒤 다시 연결해 주세요."));
        else if (state === "connecting") {
          const reason = event.detail || lifecycle.closeReason;
          recoverConnection(typeof reason === "string" ? new Error(reason) : reason, guestEntry);
        }
      });

      if (manual) {
        if (role === "host") {
          const code = await active.createOfferCode();
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
        }
        $("network-code-form").hidden = false;
        networkStatus("");
        $(role === "host" ? "network-copy" : "network-in").focus();
        return;
      }

      if (role === "host") {
        await transport.createRoom(active, {
          signal: controller.signal,
          onCode(code) {
            if (epoch !== networkEpoch) return;
            $("room-code").value = code;
            $("room-share").hidden = false;
            $("network-title").textContent = "대전 대기실";
            $("network-back-label").textContent = "방 닫기";
            networkStatus("친구의 참가를 기다리고 있어요.");
            if (document.activeElement === $("network-back")) $("room-copy").focus();
          },
        });
        if (epoch !== networkEpoch) return;
        $("room-share").hidden = true;
      } else {
        await transport.joinRoom(active, roomNumber, { signal: controller.signal });
        if (epoch !== networkEpoch) return;
      }
      networkStatus("친구와 연결 중이에요. 두 사람 모두 자기 기기의 1P 키를 사용해요.");
      await attachAndStart(active, epoch);
    } catch (error) {
      if (epoch === networkEpoch) recoverConnection(error, guestEntry);
    }
  }

  $("network-host").addEventListener("click", () => beginConnection("host", false));
  $("network-guest").addEventListener("click", () => { clearNetworkError(); showGuestEntry(); });
  $("manual-host").addEventListener("click", () => beginConnection("host", true));
  $("manual-guest").addEventListener("click", () => beginConnection("guest", true));
  $("room-number").addEventListener("input", () => {
    clearNetworkError();
    $("room-number").removeAttribute("aria-invalid");
  });
  $("room-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (networkAbort) return;
    const input = $("room-number");
    const code = input.value.normalize("NFKC").replace(/[\s-]/g, "");
    if (!/^\d{6}$/.test(code)) {
      input.setAttribute("aria-invalid", "true");
      $("network-error").textContent = "방 번호는 숫자 6자리예요. 친구에게 받은 번호를 확인해 주세요.";
      $("network-error").hidden = false;
      input.focus();
      return;
    }
    input.value = code;
    beginConnection("guest", false, code);
  });

  async function copyCode(inputId, description) {
    const input = $(inputId);
    const epoch = networkEpoch;
    try {
      await navigator.clipboard.writeText(input.value);
      if (epoch === networkEpoch) toast(description + " 복사했어요. 친구에게 보내 주세요.");
    } catch {
      if (epoch !== networkEpoch) return;
      input.focus();
      input.select();
      toast("선택한 내용을 복사해 친구에게 보내 주세요.");
    }
  }
  $("room-copy").addEventListener("click", () => copyCode("room-code", "방 번호를"));
  $("network-copy").addEventListener("click", () => copyCode("network-out", "연결 코드를"));
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
        $("network-copy").focus();
      } else {
        await active.acceptAnswerCode(code);
        if (epoch !== networkEpoch) return;
        networkStatus("친구와 연결 중이에요. 연결되면 각자 1P 키로 플레이해요.");
      }
      await attachAndStart(active, epoch);
    } catch (error) {
      if (epoch !== networkEpoch) return;
      // A failed code can be edited. Once SDP was accepted, retry with a fresh peer.
      if (active.bridge.closed || active.pc.remoteDescription) { recoverConnection(error, false); return; }
      $("network-connect").disabled = false;
      $("network-in").disabled = false;
      networkError(error);
      $("network-in").focus();
    }
  });

  function toggleGuide(open) {
    guide.hidden = !open;
    guideButton.setAttribute("aria-expanded", String(open));
    requestAnimationFrame(fitFrame);
  }
  guideButton.addEventListener("click", () => toggleGuide(guide.hidden));

  function selectFighter(fighter) {
    for (const button of $("moves-roster").children) {
      button.setAttribute("aria-pressed", String(button.dataset.fighter === fighter.id));
    }
    $("moves-fighter-title").textContent = fighter.label + " 기술";
    const content = document.createDocumentFragment();
    for (const group of window.PangyoMoves.styles[fighter.style]) {
      const section = document.createElement("section");
      section.className = "moves-section";
      const heading = document.createElement("h4");
      heading.textContent = group.label;
      const list = document.createElement("dl");
      for (const move of group.moves) {
        const row = document.createElement("div");
        const name = document.createElement("dt");
        const description = document.createElement("dd");
        const command = document.createElement("strong");
        name.textContent = move.name;
        command.textContent = move.command;
        description.append(command);
        if (move.note) {
          const note = document.createElement("small");
          note.textContent = move.note;
          description.append(note);
        }
        row.append(name, description);
        list.append(row);
      }
      section.append(heading, list);
      content.append(section);
    }
    $("moves-list").replaceChildren(content);
  }

  function openMoveGuide() {
    const fighters = window.PangyoMoves?.fighters;
    if (!fighters?.length) {
      toast("기술표를 불러오지 못했어요. 페이지를 새로고침해 주세요.");
      return;
    }
    const roster = $("moves-roster");
    if (!roster.childElementCount) {
      for (const fighter of fighters) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.fighter = fighter.id;
        const portrait = document.createElement("img");
        const portraitId = { uniform: "uniform-16bit", hood: "hood-16bit" }[fighter.id] || fighter.id;
        portrait.src = fighter.face || `assets/fighters/${portraitId}-face.png`;
        portrait.alt = "";
        button.append(portrait, fighter.label);
        button.addEventListener("click", () => selectFighter(fighter));
        roster.append(button);
      }
      selectFighter(fighters[0]);
    }
    // The engine clears held keys on window blur. A modal alone only blurs the canvas.
    if (state === "playing") window.dispatchEvent(new Event("blur"));
    movesGuide.showModal();
    $("moves-scroll").scrollTop = 0;
  }
  movesButton.addEventListener("click", openMoveGuide);
  $("moves-close").addEventListener("click", () => movesGuide.close());
  movesGuide.addEventListener("close", () => {
    (state === "playing" ? canvas : movesButton).focus({ preventScroll: true });
  });

  // The WASM listener registers on window after boot. Keep dialog keystrokes
  // out of that listener, but allow the browser's normal Tab, Esc and button actions.
  const movesKeysDown = new Set();
  function protectMoveGuide(event) {
    if (movesGuide.open || (event.target === movesButton && ["Enter", "Space"].includes(event.code))) {
      if (event.type === "keydown") movesKeysDown.add(event.code);
      else movesKeysDown.delete(event.code);
      event.stopImmediatePropagation();
    } else if (movesKeysDown.has(event.code)) {
      // A dialog-closing key may still be physically held after focus returns.
      if (event.type === "keyup") movesKeysDown.delete(event.code);
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  window.addEventListener("keydown", protectMoveGuide);
  window.addEventListener("keyup", protectMoveGuide);
  window.addEventListener("blur", () => movesKeysDown.clear());

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !guide.hidden) {
      toggleGuide(false);
      event.stopImmediatePropagation();
      if (state === "playing") canvas.focus({ preventScroll: true });
    } else if (event.key === "Escape" && state === "connecting") {
      event.preventDefault();
      if (!event.repeat) networkBack();
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
