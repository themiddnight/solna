/**
 * GENERATED FILE — do not hand-edit. Regenerate with `bun run calibration:generate`
 * (scripts/calibration/generateTrimTable.ts); hand edits are overwritten on the next run.
 * See scripts/calibration/README.md for when to re-run and what a flagged entry means.
 *
 * One measured trim per BEAT PRESET (not per voice — a patch's voices are not
 * independent; see the comment on DRUM_TRIMS below) and per synth preset.
 * `measuredDbfs` is what the uncalibrated render measured at; `trimDb` is
 * TARGET_DBFS (-18) minus it; `configHash` fingerprints exactly the
 * loudness-affecting config, so `bun run check:levels` can tell a retune from a
 * re-run.
 */
export interface TrimEntry {
  /** The uncalibrated render's short-term LUFS median, in dBFS. */
  measuredDbfs: number;
  /** TARGET_DBFS - measuredDbfs. This table is EVIDENCE: the number that ships is
   *  the copy embedded in the preset's own patch (`outputTrimDb`), which the lock
   *  test keeps equal to this one. */
  trimDb: number;
  /** sha256 over the loudness-affecting config, per scripts/calibration/loudnessConfig.ts. */
  configHash: string;
}

/** Beat preset id -> entry, measured from the patch's whole reference pattern
 *  (DEV-387). Runtime audio never reads this: the same number is embedded in
 *  `BEAT_PRESETS[i].patch.outputTrimDb`, and the lock test keeps the two equal.
 *  This table is the calibration EVIDENCE — the measurement the trim came from. */
export const DRUM_TRIMS: Record<string, TrimEntry> = {
  "808-vintage": { measuredDbfs: -17.9, trimDb: -0.1, configHash: "423c6ae829e61f52283bfaea3333d5bd998512738cba139efd433826ca5d493e" },
  "acoustic-studio": { measuredDbfs: -17.5, trimDb: -0.5, configHash: "a90acdc7dbada61bc5e5b101ba6c36fbc9828d89a983c97b744672a7d0ed6f91" },
  "chrome-pulse": { measuredDbfs: -16.8, trimDb: -1.2, configHash: "d1ac33d34da0a6f804da70bf5436da5f0140ca40463f140016845761b02bda13" },
  "club-standard": { measuredDbfs: -18.2, trimDb: 0.2, configHash: "7df938b69b860e8e567ca947652e4582351fabc28475425793b36590eb2f6ef0" },
  "dusty-break": { measuredDbfs: -18.8, trimDb: 0.8, configHash: "0405d5a6147ee1f53caffd4db26e18bb22803d2809d0c54637a28a2f1781954a" },
  "lo-fi-vinyl": { measuredDbfs: -21.2, trimDb: 3.2, configHash: "d5dafe29c10ed7a873b30d0ca9d40046f5192ba5385ea0e38dcea89072fec14e" },
  "retro-drive": { measuredDbfs: -19.1, trimDb: 1.1, configHash: "e89067e2d5aa9cf3475cef0e83735d1307b49e75ce7b689834a50c77309d90ff" },
  "sub-weight": { measuredDbfs: -16.5, trimDb: -1.5, configHash: "598587eca7310fcbc031f691f5f671450389c0ac959cb7bcbec363abdf16d185" },
  "tight-pocket": { measuredDbfs: -21.7, trimDb: 3.7, configHash: "948bdc492cf424161c4a9395719d7c1e0523972aed99078e204565dd7f01b9b2" },
  "trap-beat": { measuredDbfs: -15.6, trimDb: -2.4, configHash: "7b258bd4a9a3e1360f764647a737d50bf1bc3724de473270c1f3d359835e1ca6" },
  "velocity-breaks": { measuredDbfs: -20.6, trimDb: 2.6, configHash: "b1dc69e8ec0151c1d75cd1fdfc03e9da17afa1fbf8b7372829775d0ac87018b6" },
  "warehouse": { measuredDbfs: -18.8, trimDb: 0.8, configHash: "7a0be2af64593be63880f538134cce994d02d675f8120039a9fdb8273856d9f7" },
  "warm-riddim": { measuredDbfs: -20.7, trimDb: 2.7, configHash: "e9f079d23ac23bbb12822175ea565cb61f44cdc30478f5736d886a9e9055f613" },
};

/** Synth preset id -> entry. */
export const PRESET_TRIMS: Record<string, TrimEntry> = {
  "bass-deep-sine": { measuredDbfs: -4.8, trimDb: -13.2, configHash: "f7d6f363b99b6d54e34290c881bb7b2f24d7ef76423be6616882da8565628665" },
  "bass-punchy-square": { measuredDbfs: -9, trimDb: -9, configHash: "5215742d5f934e1872548aae80b302279aa54c9e5697d45a186bb131d1b82dad" },
  "bass-round-pluck": { measuredDbfs: -13.8, trimDb: -4.2, configHash: "81bedeb52e74e7313e6489598fc28e06dcbbf7ade07192120a91346344d1cfa0" },
  "bass-saw-growl": { measuredDbfs: -9.2, trimDb: -8.8, configHash: "7d0abed865074cef577b2a820c1fcbe761acaf0dbeeb547e333a5933ee7389dd" },
  "bass-warm-tri": { measuredDbfs: -7, trimDb: -11, configHash: "c6fad0207421c6e8ec8cca3705de85fbafc4d511f3216e60e088662e3012229c" },
  "factory-808-deep-bass": { measuredDbfs: -9.6, trimDb: -8.4, configHash: "3cf963137fbc25188dc86f596d3f4e5ddea4cd33a3bc92ae2fb23789b308acad" },
  "factory-acid-synth": { measuredDbfs: -9.4, trimDb: -8.6, configHash: "1216a5b114c65ada640a3234e100919889fb08c63555d07c060e2c85931ec2b7" },
  "factory-celestial-shimmer": { measuredDbfs: -9.7, trimDb: -8.3, configHash: "3089e6042823b02039fc7702dd4b84b56db2af578e1cd0932f7d0210f1e16041" },
  "factory-cosmic-lead": { measuredDbfs: -8.8, trimDb: -9.2, configHash: "8d5db0160ad1a2b6140e5189e1d542761b947fbceb0646adb2beea0ff72c3789" },
  "factory-cyber-drone": { measuredDbfs: -27.5, trimDb: 9.5, configHash: "33323e8861c37d49e79a99c56e7740de437407cd46b92b5f444a458ce0007bbf" },
  "factory-dark-sub-pad": { measuredDbfs: -11.9, trimDb: -6.1, configHash: "2bef88afc8afe9f9dc8da18914ae122d6adee8dc444003270d4a1c65dfcb5904" },
  "factory-dream-keys": { measuredDbfs: -11.2, trimDb: -6.8, configHash: "55a7ea4d5e4b07b36fb59fa8a631944f1f1fc8cbea781a3d6fd38fc4f58f1f43" },
  "factory-fm-tine-piano": { measuredDbfs: -11.8, trimDb: -6.2, configHash: "4872d3697f6fe7b013da787255ccda08bf24558078dc39ba5f3612c71a53dfaa" },
  "factory-fx-down-sweep": { measuredDbfs: -10.6, trimDb: -7.4, configHash: "5763af462d55e8d858076c7255b4b741527c8348aade59708106fadb5b3d6cb1" },
  "factory-fx-up-sweep": { measuredDbfs: -22.4, trimDb: 4.4, configHash: "b81ccc6ec448cc80a32b30d2289ded38b7aeae396cb5f22329cd2c72a04132a0" },
  "factory-glocken-bell": { measuredDbfs: -14.2, trimDb: -3.8, configHash: "214adb4834799a921f711eb3e473ff016c4af13907c896c0f7fe95f819fbcbb2" },
  "factory-hyper-saw-lead": { measuredDbfs: -5.9, trimDb: -12.1, configHash: "684078e8a8dc7aabcd1e04d98e4442fc8a951591dcc4bc99cb2c5f32e3ec08eb" },
  "factory-koto-pluck": { measuredDbfs: -14.2, trimDb: -3.8, configHash: "92bcf7e3c633adf27147beb551f9a61dc427bfc961df0bdac0ed2fbab382c303" },
  "factory-laser-fx": { measuredDbfs: -21.2, trimDb: 3.2, configHash: "b7547848cdc9bccc25b4635ff6a63631558e1bcfc8ef1373d0b8a3d717dd9392" },
  "factory-mellow-epiano": { measuredDbfs: -10.3, trimDb: -7.7, configHash: "948a7e68f4947afa351c2fbee23f816de4e0750abd78a781e76841f88bcc6d83" },
  "factory-neon-poly-saw": { measuredDbfs: -10.1, trimDb: -7.9, configHash: "495c2e145aeaa0d9c7b98a542174821999767c9c8e772630afb26fa8fcb45617" },
  "factory-noise-riser-fx": { measuredDbfs: -23.9, trimDb: 5.9, configHash: "c2048ba0f6e1a572f82db12e93225a8a28a18028e1e4cebe27908fdc5eec0cb8" },
  "factory-pluck": { measuredDbfs: -18.5, trimDb: 0.5, configHash: "acb792c805b59b079fe03491186d3b910efbcb11627a240854f490b84b4becf7" },
  "factory-reese-sub-bass": { measuredDbfs: -6, trimDb: -12, configHash: "63d5ec97119dfb3d23e1da3728e715743c08de6c0c7c042dba21c724f81c07b9" },
  "factory-stab-brass": { measuredDbfs: -14.7, trimDb: -3.3, configHash: "bf3e363087920637ec7204954911c9bb29c8b60a48ce40a5db39c57cc5f46ee0" },
  "factory-string-ensemble": { measuredDbfs: -8.3, trimDb: -9.7, configHash: "3f5dee9ded22ebb80c1532e1e823709e7365cf788663688f3431afac6f4e4778" },
  "factory-subtractive-init": { measuredDbfs: -7.7, trimDb: -10.3, configHash: "c88d2fe8c171eb3c2a0d0752663559cdefdc1fe94d71177e5d19157dc141e48f" },
  "factory-trance-pluck": { measuredDbfs: -19.7, trimDb: 1.7, configHash: "4f177aa9eba9a9ab8372ba9fe88a20366f04b27fc8459ae210b5282d97b15ee0" },
  "factory-vintage-brass": { measuredDbfs: -8.4, trimDb: -9.6, configHash: "bab9c440f5aa018ff0473dca33de6f5d3c63899d332c0dfcb3c6f0c3a81b5729" },
  "factory-vocal-lead": { measuredDbfs: -25.5, trimDb: 7.5, configHash: "9d394b3199b36d11e8e874006f46ebc0f89025b3fc754bdd9cafbcde8f1340fa" },
  "factory-warm-polypad": { measuredDbfs: -11.8, trimDb: -6.2, configHash: "63875aa91726d556c988ae2e63f35eeb667333b7e028acd173b8c60cc9c6d2bb" },
  "factory-wobble-bass": { measuredDbfs: -4.2, trimDb: -13.8, configHash: "901416fb4b653bcfcb7058dc61be194cd461a3688254dafd4297ac6d4b15d26e" },
};
