import type { ThemeKey } from '../themes'
import type { ScenePhase } from './index'
import type { PassageKind } from './environment'
import { smooth } from './islandTimeline'

export type LandscapeTheme = Exclude<ThemeKey, 'animal-crossing'>
export interface SceneGeometry {
  width: number; height: number; pixel: boolean; horizon: number
  sky: string; water: string; waterBounds: { x: number; y: number; w: number; h: number }[]
  moon: { x: number; y: number; r: number }; sun: { x: number; y: number; r: number; setX: number; dawnX: number }
  windows: { x: number; y: number; w: number; h: number }[]
  eaves: { x: number; y: number; fall: number }[]
  fog: { x: number; y: number; w: number; h: number; banks: string[] }
  shadows: string; glow: string; night: string
}

// Every coordinate is traced against the original full panorama, never the UI width.
export const SCENE_GEOMETRY: Record<LandscapeTheme, SceneGeometry> = {
  'pixel-jrpg': {
    width:1920,height:768,pixel:true,horizon:440,
    sky:'M0 0H1920V310L1875 353 1824 394 1788 375 1760 397 1706 389 1656 400 1617 384 1570 421 1519 391 1461 421 1400 398 1360 415 1300 360 1247 391 1191 341 1155 368 1127 337 1099 362 1056 327 1015 354 978 305 940 332 900 286 850 285 800 198 773 236 732 256 683 287 644 307 605 239 575 272 536 304 521 268 507 268 506 293 475 276 474 206 455 164 449 144 439 194 429 198 427 228 416 220 416 146 408 110 399 144 388 144 386 199 368 181 371 162 354 190 350 219 327 224 308 198 300 180 284 218 262 223 248 205 236 238 211 247 190 289 167 288 143 229 113 213 99 186 78 184 67 178 54 159 37 137 0 118Z',
    water:'M1050 526L1112 529 1156 533 1205 541 1280 545 1355 539 1430 547 1510 543 1566 551 1512 570 1432 567 1390 580 1331 580 1281 602 1240 605 1227 622 1309 637 1391 654 1383 674 1310 680 1252 671 1190 653 1132 626 1065 612 1018 598 1061 589 1150 599 1208 592 1265 574 1185 569 1116 558 1021 554 988 547Z',
    waterBounds:[{x:990,y:530,w:575,h:151}],
    moon:{x:1398,y:164,r:27},sun:{x:1345,y:120,r:24,setX:1540,dawnX:1660},
    windows:[{x:400,y:161,w:11,h:14},{x:367,y:218,w:11,h:14},{x:450,y:213,w:9,h:11},{x:328,y:253,w:9,h:13},{x:351,y:248,w:8,h:11},{x:383,y:251,w:8,h:12},{x:400,y:252,w:10,h:13},{x:445,y:286,w:10,h:13},{x:465,y:286,w:9,h:12},{x:251,y:274,w:8,h:10},{x:1229,y:483,w:7,h:12},{x:1260,y:497,w:8,h:11}],
    eaves:[{x:355,y:204,fall:45},{x:373,y:204,fall:39},{x:390,y:146,fall:45},{x:416,y:147,fall:50},{x:438,y:203,fall:38},{x:459,y:203,fall:44},{x:325,y:280,fall:48},{x:478,y:280,fall:41},{x:245,y:267,fall:35},{x:1260,y:487,fall:23}],
    fog:{x:602,y:275,w:1318,h:352,banks:['M600 461Q820 440 1040 464T1480 467T1980 480','M710 410Q900 395 1110 417T1520 431T1930 435']},
    shadows:'M327 638L700 715 545 725 319 648Z M940 582L1190 643 1130 648 927 590Z',glow:'#ffdc8b',night:'#6987ce',
  },
  'parchment-journal': {
    width:1620,height:971,pixel:false,horizon:465,
    sky:'M0 0H1620V458L1580 460 1540 444 1500 467 1460 451 1420 460 1363 446 1320 453 1280 440 1230 454 1190 440 1155 445 1126 450 1070 449 1026 435 985 434 945 418 910 410 879 415 850 398 822 388 804 372 766 368 740 350 708 322 684 321 663 299 634 311 603 270 580 264 557 231 534 213 518 198 492 226 462 251 442 268 422 254 402 287 383 299 360 286 337 305 321 273 307 276 303 232 297 218 290 249 278 235 269 233 265 197 258 188 253 208 240 206 238 170 230 158 225 190 218 164 211 137 206 123 198 166 188 170 181 158 178 133 172 155 168 209 153 208 147 187 136 198 132 216 113 228 106 197 99 212 93 233 76 232 68 215 58 236 43 230 35 211 21 224 0 218Z',
    water:'M1395 533Q1280 559 1195 585L1171 597 1190 600 1268 581 1377 550Z M1159 601Q1111 619 1003 642L969 649 942 662 966 668 1007 662 1074 654 1093 644 1061 642 1130 626 1196 613Z M916 669Q865 681 851 694L867 704 926 708 940 727 967 736 1008 744 1050 765 1096 793 1148 805 1195 827 1261 841 1280 838 1222 816 1182 795 1134 784 1090 761 1024 730 968 718 964 699 929 690 883 688 931 676Z',
    waterBounds:[{x:1170,y:533,w:235,h:66},{x:942,y:601,w:260,h:69},{x:850,y:669,w:432,h:175}],
    moon:{x:1420,y:167,r:37},sun:{x:1386,y:92,r:29,setX:1540,dawnX:1540},
    windows:[{x:215,y:169,w:8,h:12},{x:227,y:202,w:8,h:12},{x:240,y:240,w:8,h:12},{x:172,y:212,w:8,h:12},{x:125,y:237,w:7,h:10},{x:291,y:257,w:6,h:10},{x:733,y:511,w:6,h:8},{x:749,y:520,w:6,h:8},{x:970,y:653,w:8,h:5}],
    eaves:[{x:194,y:178,fall:34},{x:216,y:178,fall:40},{x:240,y:208,fall:29},{x:265,y:215,fall:31},{x:126,y:238,fall:34},{x:281,y:268,fall:28},{x:297,y:268,fall:31},{x:198,y:350,fall:66},{x:218,y:391,fall:61}],
    fog:{x:437,y:344,w:1183,h:482,banks:['M444 552Q625 521 789 548T1160 552T1680 560','M550 626Q680 608 824 630T1140 640T1550 648','M823 722Q1000 682 1180 725T1560 731']},
    shadows:'M344 814L679 918 576 945 322 825Z M577 675L820 743 744 749 566 683Z',glow:'#f3cc86',night:'#70839d',
  },
  'stardew-valley': {
    width:1920,height:720,pixel:true,horizon:282,
    sky:'M0 0H1920V184L1850 178 1815 170 1760 197 1694 169 1650 150 1630 145 1585 134 1548 160 1510 182 1476 190 1430 212 1400 202 1345 228 1310 221 1270 216 1230 227 1190 231 1150 226 1100 236 1050 226 1000 240 964 261 925 246 881 246 837 259 790 243 750 257 720 246 674 253 626 244 589 258 559 255 548 238 535 218 515 216 498 237 492 259 467 260 450 230 435 200 421 200 411 207 401 218 381 216 369 196 363 156 351 160 347 144 321 140 318 114 291 112 294 81 256 82 250 52 217 52 212 28 172 28 168 0Z',
    water:'M786 458Q845 442 919 447L988 449 1050 445 1105 453 1132 462 1182 472 1221 482 1212 492 1150 502 1108 509 1075 503 1014 509 960 510 911 501 873 497 850 485 810 480 757 475Z M1043 316L1100 314 1156 317 1228 319 1310 319 1370 327 1345 335 1276 337 1205 341 1150 333 1076 329Z',
    waterBounds:[{x:755,y:442,w:470,h:71},{x:1040,y:314,w:332,h:28}],
    moon:{x:1162,y:107,r:35},sun:{x:982,y:97,r:26,setX:805,dawnX:805},
    windows:[{x:233,y:278,w:34,h:27},{x:87,y:354,w:26,h:36},{x:239,y:355,w:27,h:43},{x:294,y:355,w:28,h:36},{x:139,y:354,w:15,h:23},{x:350,y:354,w:9,h:13},{x:615,y:316,w:16,h:23},{x:492,y:383,w:10,h:20},{x:530,y:384,w:10,h:19},{x:573,y:379,w:8,h:20}],
    eaves:[{x:55,y:341,fall:55},{x:77,y:338,fall:53},{x:126,y:335,fall:59},{x:177,y:335,fall:60},{x:224,y:338,fall:52},{x:269,y:338,fall:58},{x:312,y:340,fall:55},{x:357,y:340,fall:54},{x:485,y:368,fall:44},{x:512,y:367,fall:47},{x:540,y:367,fall:47},{x:572,y:349,fall:43},{x:649,y:347,fall:49},{x:681,y:369,fall:42}],
    fog:{x:688,y:244,w:1232,h:272,banks:['M644 353Q828 334 1004 355T1410 369T1940 359','M744 409Q988 389 1160 415T1600 430T1950 417','M1000 289Q1260 279 1450 296T1940 307']},
    shadows:'M418 480L731 563 647 576 405 488Z M1021 507L1318 581 1240 588 1003 515Z',glow:'#ffcb73',night:'#667bba',
  },
}

export function sourceViewport(width: number, height: number, sourceWidth: number, sourceHeight: number) {
  const scale=Math.max(width/sourceWidth,height/sourceHeight)
  return {scale,width:sourceWidth*scale,height:sourceHeight*scale,offsetY:(height-sourceHeight*scale)/2}
}

export function themeCelestials(theme: LandscapeTheme, from: ScenePhase, to: ScenePhase, kind: PassageKind | undefined, progress: number) {
  const g=SCENE_GEOMETRY[theme], below=g.horizon+60
  const sun={predawn:{x:g.sun.dawnX,y:below,opacity:0},dawn:{x:g.sun.dawnX,y:g.horizon-170,opacity:1},morning:{x:g.sun.x+60,y:g.sun.y+35,opacity:1},noon:{x:g.sun.x,y:g.sun.y,opacity:1},sunset:{x:g.sun.setX,y:below,opacity:0},night:{x:g.sun.setX,y:below,opacity:0}}
  const moon={predawn:{x:g.moon.x,y:g.moon.y,opacity:1},dawn:{x:g.moon.x+100,y:below,opacity:0},morning:{x:g.moon.x+100,y:below,opacity:0},noon:{x:g.moon.x-100,y:below,opacity:0},sunset:{x:g.moon.x-100,y:below,opacity:0},night:{x:g.moon.x,y:g.moon.y,opacity:1}}
  const interpolate=(table:typeof sun) => {const a=table[from],b=table[to],t=smooth(progress);return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,opacity:a.opacity+(b.opacity-a.opacity)*t}}
  const bodies={sun:interpolate(sun),moon:interpolate(moon)}
  if(kind==='sunrise'){bodies.sun.opacity=smooth(progress/.16);bodies.moon.opacity=1-smooth((progress-.6)/.3)}
  if(kind==='sunset') bodies.sun.opacity=1-smooth((progress-.93)/.07)
  if(kind==='lamps') bodies.moon.opacity=smooth(progress/.2)
  return bodies
}
