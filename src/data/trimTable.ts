/**
 * GENERATED FILE — do not hand-edit. Regenerate with `bun run calibration:generate`
 * (scripts/calibration/generateTrimTable.ts); hand edits are overwritten on the next run.
 * See scripts/calibration/README.md for when to re-run and what a flagged entry means.
 *
 * One measured trim per drum KIT (not per voice — a drum kit's voices are not
 * independent; see the comment on DRUM_TRIMS below) and per synth preset.
 * `measuredDbfs` is what the uncalibrated render measured at; `trimDb` is
 * TARGET_DBFS (-18) minus it; `configHash` fingerprints exactly the
 * loudness-affecting config, so `bun run check:levels` can tell a retune from a
 * re-run.
 */
export interface TrimEntry {
  /** The uncalibrated render's short-term LUFS median, in dBFS. */
  measuredDbfs: number;
  /** TARGET_DBFS - measuredDbfs. Applied as a linear gain by src/audio/trims.ts. */
  trimDb: number;
  /** sha256 over the loudness-affecting config, per scripts/calibration/loudnessConfig.ts. */
  configHash: string;
}

/** Kit name -> entry, measured from the kit's whole reference pattern (DEV-387). */
export const DRUM_TRIMS: Record<string, TrimEntry> = {
  "808 Vintage": { measuredDbfs: -17.9, trimDb: -0.1, configHash: "3590040766507f0ae4bda1f22aa65ee2be3c904046782c7efae06241dc5ea7d8" },
  "Acoustic Studio": { measuredDbfs: -17.5, trimDb: -0.5, configHash: "ba030ce008f907e424748412567a5721a6629f71a80db6cca55ebe52b457475e" },
  "Chrome Pulse": { measuredDbfs: -16.8, trimDb: -1.2, configHash: "6333a89a8cc4349193575d89cfb850635f08b1cb231fd0738614746f1bc5fc06" },
  "Club Standard": { measuredDbfs: -18.2, trimDb: 0.2, configHash: "b0838dc238774b5d63c32309263dc5f26acf06fb2e37ba2b7f892db8129e0c6c" },
  "Dusty Break": { measuredDbfs: -18.8, trimDb: 0.8, configHash: "4c2895e9e3399a51a932c9c6c1c759eab7ee17ae4596c6be1515d514982db866" },
  "Lo-Fi Vinyl": { measuredDbfs: -21.2, trimDb: 3.2, configHash: "d5d9fd4d669994e9a741c59361b16af1eca9556037d93c439c5963878897b074" },
  "Retro Drive": { measuredDbfs: -19.1, trimDb: 1.1, configHash: "62cc846f58b631c011af29d9b5b4a1dad1e7c7a2cbf8f9790e26c2378e9671c1" },
  "Sub Weight": { measuredDbfs: -16.5, trimDb: -1.5, configHash: "0cc09204cd53f8d09090cfbe56afd726a70aa7868e6ba63381af74332fd16afb" },
  "Tight Pocket": { measuredDbfs: -21.7, trimDb: 3.7, configHash: "7c39746e19b08c028de8f128f0119a450e4be543b9650628862770e8c84c777d" },
  "Trap Beat": { measuredDbfs: -15.6, trimDb: -2.4, configHash: "df63d1aa70345ae6258943ce7ac62fdb5770c771710651bce6c529ad36b62356" },
  "Velocity Breaks": { measuredDbfs: -20.6, trimDb: 2.6, configHash: "430715b0effc4a9433a756aa4cd25cdaa88500e6ddce206514060aaaa4afba29" },
  "Warehouse": { measuredDbfs: -18.8, trimDb: 0.8, configHash: "37d1459114bf558a43190d3ede45a4056d0cb2c31afe3bdf9b74e4e70d61cb0f" },
  "Warm Riddim": { measuredDbfs: -20.7, trimDb: 2.7, configHash: "d7adcb20c1b4ed1bed6e6398c05e60e7cc29bdea20bfb53edfb1c1e8736f3a0a" },
};

/** Synth preset id -> entry. */
export const PRESET_TRIMS: Record<string, TrimEntry> = {
  "bass-deep-sine": { measuredDbfs: -7.6, trimDb: -10.4, configHash: "e19a88019b298edaeafac98c79943bd7ff99bb1ce8c2949ad98ad0ad6963cef3" },
  "bass-punchy-square": { measuredDbfs: -11.5, trimDb: -6.5, configHash: "d9a0fedba7db1e582fe91e44069f76c126950f96cdc28fc86f4b0fdb46171005" },
  "bass-round-pluck": { measuredDbfs: -17.3, trimDb: -0.7, configHash: "54048ba02d6adee7ca759a3418525acd72c0b3ab17faadbd96ef57d267c2ca9e" },
  "bass-saw-growl": { measuredDbfs: -13.7, trimDb: -4.3, configHash: "867e5a6d9dc10bfbd219c8224dd644b60552e5207a84892d800ea56b71942809" },
  "bass-warm-tri": { measuredDbfs: -12.4, trimDb: -5.6, configHash: "cb70bad6677ed53ad8b0c17a26fc64a8ff6d61882188c8a0e0e2706542d56a8b" },
  "factory-808-deep-bass": { measuredDbfs: -16.5, trimDb: -1.5, configHash: "bb1ae207f503fa00c3b943a0b689e3c0b56b613029c10d27f83093a9b36b9af6" },
  "factory-acid-synth": { measuredDbfs: -23.3, trimDb: 5.3, configHash: "745a0ed5d2a238314811c78d00b9d7d781385b6d342fee901d2302308a703508" },
  "factory-celestial-shimmer": { measuredDbfs: -11.3, trimDb: -6.7, configHash: "bd5bf110307e8be8ac1abd0473e749dc22b1f7a6be991be375757614eec19e48" },
  "factory-cosmic-lead": { measuredDbfs: -13.4, trimDb: -4.6, configHash: "ab0296dfeac4bd0d903d2da4454c90ec562d5e4d4adddc4e0732c72aed943c88" },
  "factory-cyber-drone": { measuredDbfs: -25.7, trimDb: 7.7, configHash: "4dbe8d7aad04600cf9f427b44e87259d71e00e4b204988d91a71894d47cd442b" },
  "factory-dark-sub-pad": { measuredDbfs: -14.5, trimDb: -3.5, configHash: "24b4ef587080195ee5e37ac98b25503a44cf8c61be3495f783f5a6150ad9bcf6" },
  "factory-dream-keys": { measuredDbfs: -15.1, trimDb: -2.9, configHash: "93971adbdab3911f9bc892c47d2dd5d80e41fb2e0a8f6dc95915642628622564" },
  "factory-fm-tine-piano": { measuredDbfs: -17.6, trimDb: -0.4, configHash: "7511b70edf1222c19d9bd070d3e699d9c5e22ac7bca0017e6e99e9ca4184bd7a" },
  "factory-glocken-bell": { measuredDbfs: -15.7, trimDb: -2.3, configHash: "0ed3b9d5bd3353ae7ad420e0d88c460604232275677f91ad9e48a134959cf376" },
  "factory-hyper-saw-lead": { measuredDbfs: -12.7, trimDb: -5.3, configHash: "86723fe3af2094fe44467b7903f2501ac2e2ca01c53a98b86ffa5abfef949050" },
  "factory-koto-pluck": { measuredDbfs: -15.1, trimDb: -2.9, configHash: "de8420f206374c776f865b4ba287b295ee876e025b4ca466846aca9f1f3b8602" },
  "factory-laser-fx": { measuredDbfs: -18.2, trimDb: 0.2, configHash: "453d9bacc5117fde706590929a7434019ca7e48e74ff17b276c0a2ba335b6053" },
  "factory-mellow-epiano": { measuredDbfs: -14.7, trimDb: -3.3, configHash: "2ba897374e4e24007b7471b64e80d3ffa4fde428f6741e22c6c3837c068f576c" },
  "factory-neon-poly-saw": { measuredDbfs: -13.5, trimDb: -4.5, configHash: "cdda04da9f9ea4f6f297606a2ef2b3838fbfe34fd4dbfe1e4145519f536f03fa" },
  "factory-noise-riser-fx": { measuredDbfs: -19.3, trimDb: 1.3, configHash: "505cd08e3be79f8a640d068340b544e3f5abce8266d45aea6eb31fd12a069ddb" },
  "factory-pluck": { measuredDbfs: -23.2, trimDb: 5.2, configHash: "907e58c5af284d657a0a5991dc01e08d682ac35c7ac3e01ea43aff55ec9226d7" },
  "factory-reese-sub-bass": { measuredDbfs: -13.1, trimDb: -4.9, configHash: "00b546ef829f20b7bd41357dc822b499354fbd3eeb78d608f7a83d0080479f2d" },
  "factory-stab-brass": { measuredDbfs: -15.9, trimDb: -2.1, configHash: "f97d690bcd9f5e90650322f4bbe15245cd56da1641ab426f72a55860d1c8f844" },
  "factory-string-ensemble": { measuredDbfs: -12.8, trimDb: -5.2, configHash: "6498a91c2d11682a72b6be9d90607353c6371173300e3100d62d2016b9d77b5b" },
  "factory-trance-pluck": { measuredDbfs: -28.5, trimDb: 10.5, configHash: "7115e3cd9e56f8cfa9180df70d40db3c35af86e4ee94a36a25c83d43e9920c33" },
  "factory-vintage-brass": { measuredDbfs: -14.2, trimDb: -3.8, configHash: "f7bee8c285bcb7506fc389865bf4fea05b093d31b6cceea764d486085feb5b83" },
  "factory-vocal-lead": { measuredDbfs: -14, trimDb: -4, configHash: "7ba01fd9f2eeb283af162ac76171791f1da1080d7aca9abcbc29f3f275ba5223" },
  "factory-warm-polypad": { measuredDbfs: -13.3, trimDb: -4.7, configHash: "366d811d1e18d40c41f6ee9327546530b15583bc208ddf3f1fc3f4ba79aaaf93" },
  "factory-wobble-bass": { measuredDbfs: -19, trimDb: 1, configHash: "5ba40f210cd7103545dba35d6cf8b8647fbad81a725e3ee67c249a60e5a01301" },
};
