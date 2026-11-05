// Right-facing commands from the active PotS character definitions and input states.
// The Korean browser guide and the pause-menu lists use this same catalog.
(() => {
  "use strict";
  const move = (name, command, note = "") => ({ name, command, note });
  const section = (label, ...moves) => ({ label, moves });
  const qcf = "↓ ↘ →", qcb = "↓ ↙ ←", dp = "→ ↓ ↘";
  const doubleForward = qcf + " " + qcf, doubleBack = qcb + " " + qcb;
  const punchEX = "EX는 PP, 게이지 반 칸.";
  const kickEX = "EX는 KK, 게이지 반 칸.";
  const systemMoves = [
    move("앞 대시 · 달리기", "→ →", "두 번째 앞 방향을 유지하면 달려."),
    move("백 대시", "← ←"),
    move("작은 점프", "↑", "짧게 눌렀다 떼."),
    move("높은 점프", "↓ ↑", "아래를 짧게 누른 직후 점프."),
    move("패링", "→ / ↓", "공격이 닿기 직전에 입력. 상단·공중은 앞, 하단은 아래."),
    move("제자리 회피", "LP + LK", "회피 중 P 또는 K로 반격."),
    move("앞구르기 · 뒤구르기", "(→ / ←) + LP + LK"),
    move("게이지 모으기", "MP + MK", "두 버튼을 누른 채 유지."),
    move("커스텀 콤보", "HP + HK", "게이지 2칸. 지상·공중에서 발동."),
    move("가드 캔슬", "→ + PP / → + KK", "가드 중 게이지 1칸. PP는 펀치, KK는 킥으로 반격."),
    move("도발", "START")
  ];
  const ryu = [
    section("필살기",
      move("파동권", qcf + " + P", punchEX),
      move("승룡권", dp + " + P", punchEX),
      move("용권선풍각", qcb + " + K", "지상·공중. " + kickEX),
      move("상단족도차기", qcf + " + K", kickEX),
      move("전인연기", "↓ ↓ + P", "다음 파동권을 강화해."),
      move("파동의 자세", qcf + " + START", "파동권을 쏘는 척하는 페인트.")
    ),
    section("슈퍼 콤보 · 게이지 1칸",
      move("진공파동권", doubleForward + " + P"),
      move("진공용권선풍각", doubleBack + " + K"),
      move("전인파동권", doubleBack + " + P", "펀치를 누르고 있으면 충전돼."),
      move("전인연격", doubleForward + " + K")
    ),
    section("슈퍼 콤보 · 게이지 2~3칸",
      move("바람의 권", "↓ ↓ ↓ + PP", "2칸"),
      move("진 승룡권", doubleForward + " + KK", "3칸")
    ),
    section("특수기 · 잡기",
      move("쇄골깨기", "→ + MP"),
      move("선풍각", "→ + MK"),
      move("구미깨기", "→ + HP"),
      move("상단 이연격", "MP, HK", "근거리에서 선 채로 중펀치를 맞히거나 가드시킨 뒤 강킥."),
      move("업어치기", "(→ / ←) + PP", "지상 근거리."),
      move("배대뒤치기", "(→ / ←) + KK", "지상 근거리.")
    ),
    section("이동 · 방어", ...systemMoves,
      move("낙법", "P / K", "피격 후 낙법이 가능한 타이밍에 입력.")
    )
  ];
  const sakura = [
    section("필살기 · 기본 / 다크 공통",
      move("파동권", qcf + " + P", "기본 모드에서는 P를 길게 눌러 충전. 기본 모드 " + punchEX),
      move("천앙파동권", qcb + " + P", "위쪽으로 발사. 기본 모드에서는 충전 가능. 기본 모드 " + punchEX),
      move("소앵권", dp + " + P", "기본 모드 " + punchEX),
      move("춘풍각", qcb + " + K", "지상 또는 점프해 높이 오른 뒤. 기본 모드 " + kickEX)
    ),
    section("기본 모드 전용",
      move("사쿠라 오토시", dp + " + K", kickEX),
      move("오토시 추가타", "P", "오토시 도중 P로 내려찍기. 일반판은 추가타를 최대 3번, 하강 중 K로 취소."),
      move("EX 도발", "↓ ↓ + START", "게이지 반 칸."),
      move("사쿠라 댄스", qcf + " + START")
    ),
    section("다크 모드 전용",
      move("공중 파동권", qcf + " + P", "점프 중 공중에서 입력."),
      move("앵화각", qcf + " + K", "수직 또는 앞으로 점프해 높이 오른 뒤 입력."),
      move("사쿠라 선공", "(→ ↓ ↘ / ← ↓ ↙) + (PPP / KKK)", "지상 순간이동. 펀치 3개 또는 킥 3개를 동시에 눌러.")
    ),
    section("슈퍼 콤보 · 게이지 1칸",
      move("진공파동권", doubleForward + " + P"),
      move("진공천앙파동권", doubleBack + " + P"),
      move("미다레자쿠라", doubleForward + " + K"),
      move("하루 이치반", doubleBack + " + K"),
      move("모드 전환", "↓ ↓ ↓ + KK", "지상에서 기본 모드와 다크 모드를 전환해.")
    ),
    section("슈퍼 콤보 · 게이지 2~3칸",
      move("하루 잇센", doubleForward + " + KK", "2칸"),
      move("열혈파동권", doubleForward + " + PP", "3칸 · 기본 모드"),
      move("후쿠 파동권", doubleBack + " + PP", "3칸 · 다크 모드"),
      move("순옥살", "LP, LP, →, LK, HP", "3칸 · 두 모드 공통. 순서대로 입력.")
    ),
    section("특수기 · 잡기",
      move("플라워 킥", "→ + MK"),
      move("타깃 콤보 1", "MP, → + MK", "기본 모드. 멀리서 선 중펀치를 맞히거나 가드시킨 뒤 입력."),
      move("타깃 콤보 2", "↓ + MK, MK", "기본 모드. 앉아 중킥을 맞히거나 가드시킨 뒤 서서 중킥."),
      move("세일러 슛", "(→ / ←) + PP", "지상 근거리."),
      move("사쿠라 조르기", "(→ / ←) + KK", "지상 근거리."),
      move("세일러 플라이", "(→ / ←) + (PP / KK)", "두 캐릭터가 모두 공중에서 가까이 있을 때.")
    ),
    section("이동 · 방어", ...systemMoves,
      move("낙법", "P", "피격 후 낙법이 가능한 타이밍에 입력."),
      move("구르기 낙법", "K", "피격 후 땅에 닿기 직전에 입력.")
    )
  ];
  window.PangyoMoves = {
    fighters: [
      { id: "uniform", label: "교복", style: "ryu" },
      { id: "lifeuniform", label: "생활복", style: "sakura" },
      { id: "hood", label: "후드", style: "ryu" },
      { id: "ryu", label: "류", style: "ryu" },
      { id: "sakura", label: "사쿠라", style: "sakura" }
    ],
    styles: { ryu, sakura }
  };
})();
