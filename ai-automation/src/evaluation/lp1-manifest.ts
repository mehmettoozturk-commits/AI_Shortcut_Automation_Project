import { createHash } from "node:crypto";
import { LP1_CATEGORIES, type LP1Case } from "./lp1-types.js";

export const ENCODING_VERSION = "lp1-canonical-json-v1";
/** Object keys sorted by code point, arrays ordered; finite JSON only, no NFC
 * rewriting inside hashes. Text normalization belongs to overlap review only. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("Non-JSON manifest value");
}
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
export const caseHash = (test: LP1Case) => hash({ encoding: ENCODING_VERSION, case: test });
export const corpusHash = (cases: readonly LP1Case[]) => hash({ encoding: ENCODING_VERSION,
  cases: [...cases].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(c => ({ id: c.id, hash: caseHash(c) })) });

export const normalizedInput = (input: string): string => input.normalize("NFC").toLocaleLowerCase("tr")
  .replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
export const numericFamily = (input: string): string => normalizedInput(input).replace(/\d+/g, "#");

/** Golden values are frozen after authored corpus review, never auto-updated in tests. */
export const GOLDEN_CORPUS_HASH = "bb048603d228cdda4200401a7b4925eff42ca0a600bd47b554a6ef5c1f4e31fa";
export const GOLDEN_CASE_HASHES: Readonly<Record<string, string>> = Object.freeze({
  "basit-0": "1a352655823543355527fbfa50a77b9c5960af74bd6468390de850fd4f297338",
  "parametreli-0": "2c5b269baf0c6da6d7b1cce44d42fd93d4f603bac8d608725c4723b162f87f1c",
  "eksik-0": "b0146b2e23a5de08f8301a28656c4fe217efff5d0cc8ff4c5de2cc3d10958d78",
  "destek-0": "5c855eaf42366e97b947dd20f45f49f044216d5cb755bd5a0ed36f735cb74d1b",
  "cok-0": "6f00c9f580a8d986a2aa48dc9042d2f66759c2b41b6ee7dc01c3cb33490b31f8",
  "guven-0": "ef124d9f2fd78a5aa26cc4de2daeaaf4434b21dd6719fb71ea271d9a8ec4876b",
  "belirsiz-0": "f55a407be5383c02cb7b94b39e7dcd4691f8ffce72f646c1cf79caeb05852bd8",
  "basit-1": "94a76876f2a97e9df6af477b3bb43cddcb01c87d77e2ff71a58f66605630282f",
  "parametreli-1": "8914f14b6010cbae837b2935f72b0c1242e5002a1f1b17819266d1604f31ed6b",
  "eksik-1": "4321fee3dfb2b294965c872fbf89af6be0b8d14cd6337cb3aa28bb73b21f4734",
  "destek-1": "7cc5a1b0c0c050f3991e9f27c26259dc26bd0bd3bbafbda80370eb5a889a6eb6",
  "cok-1": "0e6b2519f6730993c70c21c2945d81b2b046f9c36f5cc3d9af93533178cba321",
  "guven-1": "773318806c5bedad8a79fb13ad2715b89eac9b7e5c3ce9fcf8274dd83d1f6298",
  "belirsiz-1": "6ffb0e07f255b946b766f989296b6093087680d1991a9cf08ac41841a0afcdbc",
  "basit-2": "fce914570560f2516a99bc0f6a5fe766c6e89dcbf252e2f60c3e89a41015ff3c",
  "parametreli-2": "85fa966e32b4cd4d1acb31f8ee9b37ddd80b5259500c0371852f20e34a0eddb9",
  "eksik-2": "bc20c037dfde59df7d342210932dde5bd7406e33afd16ac6ba0c0e73ebdc3af4",
  "destek-2": "d54b3fe1295e58ac80dc9f7c93a7b4a88bbabad85e473665568579e83c8228e0",
  "cok-2": "d549a94c0b9c79e9903be839b5bb5889e7e4de18e87d9dbd249e60690345f45a",
  "guven-2": "bbfde99252f84a749f8d4bb435db173d531f59264c678c4ef3d606d9aadce907",
  "belirsiz-2": "1c3c11ff54cf32e0f522c78cef518cb00d891ac74677bd815ebcba31a9816fc3",
  "basit-3": "45eea38e85b33c8bd3c78c07df2ec5939ab1c025c3cb508f00dfa7fe29b29ec8",
  "parametreli-3": "227e49555914d05f3b8e46e459971e85c787eca5bfd22b72a556e58a0d7bb94b",
  "eksik-3": "61d4e6b2849229ece3ac03524f9fda830654787a34dfade0378c33af510d839f",
  "destek-3": "ffb0c42790d8c4e59f9fe8409b569b9dc415e4d5c154082aa428fee9a8910c29",
  "cok-3": "4b335bc61bb50d7e1637f32e6bc00761b66ea2a1f5bcb37047283c17420918fa",
  "guven-3": "c198924c2f94182a3c78ab5a2589a49a99bfa750328a77be90287f30f2058c3e",
  "belirsiz-3": "9226170058edb7d600e02c9d03d566b8e7f7741c00ea6227c851865dfabc81e9",
  "basit-4": "1499044d244134a4421953c5cf7cd96eba5767feb89cf0e18332d8cd36d36570",
  "parametreli-4": "07d159b36689abc0ac5a4299b14dd74ae1aa46a7c37369814ce304f79e064512",
  "eksik-4": "0dd167dc2cb7b2bf178a19cc205be262c435ed40814e01fac6c924374b6ed512",
  "destek-4": "3bbc93f9d873523873d8420c7bde06b298f0793b65a434df9e8bfaf95e24dd59",
  "cok-4": "3ea7ae8f1db7881ebd7ecf1ac3f1433b0402485d209efc7cdf7fceeb62e8dc0d",
  "guven-4": "4c984e97cc5fff5141df4399a66033c0f074b0319fbcef18abe9262e77b282d7",
  "belirsiz-4": "277c30dc4adc346a0ca51c63473f5d137a4d72adb879f67ccdcfaf283be413e1",
  "basit-5": "02f7f0d88c9d60c7033e0e1d7d358d9359d7837032a2beb7062fe5a0465ed32b",
  "parametreli-5": "ec09357f1d1481b15fd9ed016897dec561f81087e4e99ec9b84cbfa2acdac811",
  "eksik-5": "572b3b6142fc1570ca5f95705010ecd6de32c23fcb0027ee052eac876c43c217",
  "destek-5": "709e09032d7b8f1680451955f92439db1f6a246536707f835fb77a0d97d9b52b",
  "cok-5": "b4f4b7e35cfd9321ed538d411dae5ec89f2e5bdfd7e3cd87a6359c2f3a8c3119",
  "guven-5": "d655e5ec7cd771397b0f203a30edf9d588af29448b964b918a5ea52a5fe4fab2",
  "belirsiz-5": "4c62e3b66b142ad9cc53d4e45fbe2c1bf03b1f82465fbf3ba9d1b50bcfa4ad76",
  "basit-6": "596182461a4251962a8b8ae5763787f779d38674c167e3c3999a87fcc60032e2",
  "parametreli-6": "15ef4f7a5441b4898f6aeb31bdc4ed1f72eb150d3091a430a2c34f462ed2ead1",
  "eksik-6": "6bc1f4692ec37d2bb1c9d6422a7bccbd91b04a176b3923b77764c63c40b435f6",
  "destek-6": "e1cad9551978a131942a9d427ec1f47e76b94338834807a7cac5e2bda616b9a8",
  "cok-6": "3f847e8c9a85a41a31c560049aa7445824642ece805f0d8bef171cd536ea2708",
  "guven-6": "4bf914021f320c29460401ca7a7d8b0d54529d907262b4eadb87b2e64113b0cf",
  "belirsiz-6": "b7e962681a33a1531f320a8aabe005575fe871bb082ddd5fc543892bdb14ec53",
  "basit-7": "b589bacd7d73698b7bacf8cdc41032bf66e4d11e3a18d56c68977033b6d132b8",
  "parametreli-7": "c4d1258cbdf87f3b44ae9f79634570829ab9c910632f11e19e2dd1009d124d68",
  "eksik-7": "c0daef2625db60ab68c98d136959ad39a3fd046c26abfd5061bc528638ce76c4",
  "destek-7": "c2b5be6a0813268e24bd63671c993fc72e6203992dce7061c4574caa4f1c505a",
  "cok-7": "836e98c078e5ef28960d52f28c7acbd4e5f815a286ed63db389c2ded49263283",
  "guven-7": "de3691f3eb81be0dc1374990b9a05bb9a49f8da84c687b7196b44e82bce17dc2",
  "belirsiz-7": "d02412741e80123c8e46cafee56a790ddfdd87056b9dae7b3a5d022981b6354d",
  "basit-8": "7439548c6d30b568d1d6e026f4861af5db21ab12efe25322e2f1b012f69e361e",
  "parametreli-8": "3ae1423a09680808de4529b3c25cd30828c39647d556c8f354007f8e0be3949d",
  "eksik-8": "edfbc0d804c98288607333306888c5978c0af50b21a099202871a27732e48b1f",
  "destek-8": "fe3836dab8f364f81e536fa7318afd59b58db807a4a2bf72ece8258c46324153",
  "cok-8": "9f8b1f737942799f44499466de823bb44740e9d4c8ae7f77811ac2ff0d67e7e4",
  "guven-8": "7aaadd2754977b79a4814f2fd014828a5c5c8f0b0ee5632d523163736ace4df5",
  "belirsiz-8": "9eb3f9fc4630b201d7b6bf0007218bfb2df297ccbb6b01ed36ce61306fa63df0",
  "basit-9": "be9477752668e6c8269d9ab4f7fcf2ee99dcb995966aee3610766b7dedcc71e7",
  "parametreli-9": "cb1cfafdad9efc3626f48092b2af8f4666dbbcab08652ed3ab3e314cc3282796",
  "eksik-9": "6544d6ecb367db7928e16f71722909a460b18e0d763b602c2b211acf70638f68",
  "destek-9": "c1a3df6bda0ca800e7f9dd7ea94794585fdc1cbc2bee31629f6e1ee080bc0c17",
  "cok-9": "1aade5b3579e0bfd1160f78baba1840cca439fe675608403748fd9d4226dd822",
  "guven-9": "4f4c49d71c16a05f0923a9897cf188ca87ee56502bd3b8bc4188ed0384af0502",
  "belirsiz-9": "3e2c049c6905e431560de687ce8a56a9541e6581c1b1137b3d1d29e8deca919f",
  "basit-10": "32983349ed0074948c093a3d8293e7f310e97cf5fd0b8227c4164ec276f91c39",
  "parametreli-10": "2897806ff4949053d2a07c6810b57ae047bc933ff1ced32a009ca73a53cd0222",
  "eksik-10": "c340e6290240889ac4346f2b19a7e8f1035c8371ed021f9dfe11624358827ece",
  "destek-10": "3fca260a5da4bf0edb6f6b62afe5d14b89ad15bc0021b3c06bdb366dafe83a61",
  "cok-10": "56d789956d174243dad81141c83e8fffa01401d67d6e0e5de43d2ce22e5fa622",
  "guven-10": "480a769f88a4afc5e3046b13341580a867a4e6a34ba9880af9badc7fdf2a41ff",
  "belirsiz-10": "1c8d1e5088d61bf9ece316610e3a09b5bac87136652d2951230b460b7302d963",
  "basit-11": "9a549c3ed928dc97eef9a5430e9bbf6dc8a25edec418c4fa32f7dc7d2a44276c",
  "parametreli-11": "ff1a442c1e4bd2a402de78c4dd03e660f36f721328ca984277065d62226aa845",
  "eksik-11": "82fe9cd466b3dcc06147f4b2b1d32c6cd1fc370bbcc71ab670f31f7efe72411e",
  "destek-11": "d9610a1ff563da0fff934f2b4edc62ba233baa5ed8b569b3db3d33a94c98f6b3",
  "cok-11": "af0375ebe1f3f523678f5f25854f9058224f8754095554c748ce5483cd114f3c",
  "guven-11": "d1cf3d5460002482e36d15ea90788b9b079a892ccedb493774f46a5a6c205b77",
  "belirsiz-11": "4197eda74237df40d1ccf469f5de06065f77e16ed60cd1d3d0c95cf15a79f5a2",
  "basit-12": "67c49b1a0637e5d2f111d2ceffd6460aa2764dc223498929acfcfcf951791933",
  "parametreli-12": "8239f0f4110a8cac5b8a2a0fa3b04ad732e7c97ed9c02db8c389015d61ca6ab5",
  "eksik-12": "d855c03c63932bfc98d3332fcede25ce1aaae7e09893273904007c3a96f2b9f1",
  "destek-12": "b687365c3d7ae1d6504563aba8f3290ac5d9d12e00090613e3cb0f94f2f33f1f",
  "cok-12": "0e7856ce4a2438dcd25b46b0fde7beb8c5714457d7d60c3977c20d1d7711c249",
  "guven-12": "0efa1ca02c65ab4937e799ff8c1ed34edfdfe5f7485e62a58ef96ea409c2133f",
  "belirsiz-12": "3313ab80822e232f1a21f1e99b36b0297ef610805f58bbb1c75fa199cc095989",
  "holdout-basit-0": "6bb262950b545a7153069c764d33141846cf01afc9d3a125922265dd8dff0a39",
  "holdout-basit-1": "efa332bfca94691c9d7636ae0ecd788b5dcc50b3aaaf89f9e73c00d7316d8d0e",
  "holdout-basit-2": "9bdbb27ca98e7a19d0ad66bc39c3dcfe96313436e77a4936acd819d368d54b0c",
  "holdout-basit-3": "218b1213d8254a098a082862b7d2b1aa3a6a934bab435838d0a9e6f4b8219c00",
  "holdout-basit-4": "66d972bc4c8055bff8b493a77502f74994832230bb7e44b203ddd5f0a88e1a27",
  "holdout-parametreli-0": "bbf3103fd3dd14e3fc5b77269ba48d16e2e85fe2b3f11bf0f7f5403c3d3539ac",
  "holdout-parametreli-1": "0a9aaee7e7e4c4b6b8a4550ab0cd5e476b2f942b66a2511da082e0b1cd023e09",
  "holdout-parametreli-2": "fbdbd7cbae1af5a10e58d4307493ad04c19ff11dbc4c2f4f0ec7fc7af0372899",
  "holdout-parametreli-3": "e064d79dad5049f23dae87645fe992f689725c933e058ecec3913d170ecb3328",
  "holdout-parametreli-4": "67c1b0aab07612c78f5ce5b3efb203729df06eeccb00596d57aaf37c44941152",
  "holdout-eksik_bilgi-0": "a73a6fbca69fe1a2b7145026df5ba9269df6938b68f40a61e58378800f35452a",
  "holdout-eksik_bilgi-1": "502b7048c3f32802fdb6ba87115a0daf1097f9541e1a5d826a6452f998b89c21",
  "holdout-eksik_bilgi-2": "a18e635b942bebb75f62aaf233bca1ada2a3bcc54f9f46fc93020221b434c57f",
  "holdout-eksik_bilgi-3": "c91ca3e2469142ee484f97f4f975ffa454c51126a4b649be36164878163e3b51",
  "holdout-eksik_bilgi-4": "9641448c3483941475e1572523069bbb738e52231313086a48a88285abe78857",
  "holdout-desteklenmeyen-0": "a32e85bb7a34500fd97955908aa72c034766251b489e08955e56e08e9ec26be2",
  "holdout-desteklenmeyen-1": "5e830e86b017135493433f921f167610b1e8c73022fe0ce14b8cbc3bbfd142ca",
  "holdout-desteklenmeyen-2": "9ccaa0e4bd8704db3f0118d8480206d97ec6cf14fae23ce844c676ed4ea5099f",
  "holdout-desteklenmeyen-3": "68741db96c4689d05a256814c4125ac2a694240af86b5d7b51f51b67a4c6e776",
  "holdout-desteklenmeyen-4": "14c4741eab19f201b21160d162621eb830b7db106acac74959feb275a46abc32",
  "holdout-cok_adimli-0": "c8708bedc3c424e4e32bc59da6016fba5aa4bc44d07e1b26d20c05930d5312e8",
  "holdout-cok_adimli-1": "dfe2ac5730e65bf823f3d895528c4125e532e538911a2f5d7e333ea71fd7b27e",
  "holdout-cok_adimli-2": "05b4eeb601ac0128fc8cabdb57e87119a4a313e9793b92f115d5f21918c01853",
  "holdout-cok_adimli-3": "2e71e397b04851f4cbdaf92d264bc64a33270969fd7dbb532448a22fa1b8b500",
  "holdout-cok_adimli-4": "dbd4c0b94ca228ecbff628261a9c176c0e3ae9ea4c73a175953ad188234f545a",
  "holdout-guvenlik-0": "eb487a7ae618c9ed9a6b2269001050ab2109601b9380bbe1fb4639bd6e5f9b20",
  "holdout-guvenlik-1": "4b8258d70bbedbe6755bc000ce304b10b1db0477cc1b0d372b66829169688c25",
  "holdout-guvenlik-2": "676d0e486e397d8f086ed39b8d763a2273f5da1bee5d7979e69b7e81d7153f70",
  "holdout-guvenlik-3": "69008dc5090e6cb8d1641b5fe49b723c6386ce721054fa2879db51021ba8de78",
  "holdout-guvenlik-4": "fe5a4f7d9e9b8e9b8315e4b6ab58822f05d8cdaa566853fd5c7b5e6e312c2d58",
  "holdout-belirsiz-0": "be507e74cc8552e4c3b9769232c666de0641c01d6887eb1cab8bb99343f57e9c",
  "holdout-belirsiz-1": "59ee772ddc120d9eb190503c3b196617ac1c7ecfc82c2434534acc90352dc9a0",
  "holdout-belirsiz-2": "8093624a2047dbb06533d3d4c4319d9dfebbbea2d2d72ba28d68b9bfdaf29e03",
  "holdout-belirsiz-3": "ec7fbcb87020d88ccf6e38ff146d055b18d8464dfb8ce02abb6e4d52e376efae",
  "holdout-belirsiz-4": "d164fab025d6e3d3f2e3321baead53a3ba5d79c0a5b3ca8cb023230a00233c28",
  "holdout-olumsuzlama_duzeltme-0": "2658e533205a8b7d8820b5dd8f76009f6cfbcb1256efa43db432556447dbbf38",
  "holdout-olumsuzlama_duzeltme-1": "37e037c340fa33efe69ba91d5b43eb7995ac5cf6a6be6ef0c12c0ac4bf7a0f61",
  "holdout-olumsuzlama_duzeltme-2": "472d9b43d9108239527ec9fd229e3b1a5f36b42325d8e460aad374ef5a47cf24",
  "holdout-olumsuzlama_duzeltme-3": "7e3378887e5c26a23f44614b813ffd3ab303b08f7586f64a57e5ad996a563f8a",
  "holdout-olumsuzlama_duzeltme-4": "f2ec83221ea6959bc195aa44efefecd63ce97159805142fe081c54e7fc7b4b3b",
});

export function auditCorpus(cases: readonly LP1Case[]): string[] {
  const failures: string[] = [];
  const seen = new Set<string>(), texts = new Set<string>();
  for (const test of cases) {
    if (seen.has(test.id)) failures.push(`duplicate_id:${test.id}`);
    seen.add(test.id);
    const text = normalizedInput(test.input);
    if (texts.has(text)) failures.push(`duplicate_text:${test.id}`);
    texts.add(text);
    if (caseHash(test) !== GOLDEN_CASE_HASHES[test.id]) failures.push(`case_hash:${test.id}`);
    // Presence checks complement hashes; golden hashes are not semantic validation.
    if (!test.familyId || !test.oracle.intent || !test.oracle.approval || !test.risk
      || !Array.isArray(test.oracle.runtimePermissions) || !Array.isArray(test.oracle.externalSetup)
      || (test.oracle.status === "plan" && !test.oracle.plan)
      || (test.oracle.status === "needs_clarification" && !test.oracle.question)) failures.push(`incomplete_oracle:${test.id}`);
  }
  if (cases.length !== 131 || cases.filter(c => c.split === "regression").length !== 91
    || cases.filter(c => c.split === "holdout").length !== 40) failures.push("split_counts");
  for (const category of LP1_CATEGORIES) {
    if (cases.filter(c => c.split === "holdout" && c.category === category).length !== 5) failures.push(`holdout_count:${category}`);
  }
  const training = cases.filter(c => c.split === "regression");
  for (const test of cases.filter(c => c.split === "holdout")) {
    if (training.some(c => c.familyId === test.familyId || numericFamily(c.input) === numericFamily(test.input))) failures.push(`cross_split_overlap:${test.id}`);
  }
  if (corpusHash(cases) !== GOLDEN_CORPUS_HASH) failures.push("corpus_hash");
  return failures;
}
