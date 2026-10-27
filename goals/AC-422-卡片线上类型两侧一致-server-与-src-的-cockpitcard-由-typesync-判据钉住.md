---
id: AC-422
title: 卡片线上类型两侧一致：server 与 src 的 CockpitCard 由 TypeSync 判据钉住
status: achieved
kind: criterion
goal: GOAL-050
criterion: npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts
expect: 测试读取 server/shared/types.ts 与 src/shared/types.ts 里的
  CockpitCard（及其选项、事实、标签类型），比对两侧的字段集合与 kind、state、source、标签 kind
  的字面量联合，两侧一致时通过；任一侧增删字段或字面量即红，且失败信息指出是哪一侧、哪个字段。取假形态：只读一侧、或只比字段名不比字面量联合即不成立。当前必红：src/shared/tests/cockpitCardTypeSync.test.ts
  不存在。
origin: frontend-module-standards 规定镜像服务端线上形状时必须有读两侧的 TypeSync 判据（先例
  wireContractTypeSync.test.ts）；本会话 2026-10-27 卡片契约 v0。
activatedAt: 2026-10-27T02:50:06.286Z
statusLog:
  - at: 2026-10-27T02:50:06.286Z
    from: draft
    to: active
    actor: claude-session-摄像头与阻塞项驾驶舱
    reason: 用户 2026-10-27 批准激活 GOAL-050（调整正文后）
  - at: 2026-10-27T03:03:38.064Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-27T02:50:06.286Z
---
