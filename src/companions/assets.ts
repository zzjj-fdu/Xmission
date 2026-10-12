import type { ThemeKey } from '../themes'
export const FOX_ASSETS:Record<ThemeKey,string>={
 'pixel-jrpg':'jrpg','parchment-journal':'journal','animal-crossing':'island','stardew-valley':'farm',
}
export const FOX_ASSET_REVISION='organic-hug-contact-v16b'
export const foxAtlas=(theme:ThemeKey)=>import.meta.env.BASE_URL+'pets/fox/'+FOX_ASSETS[theme]+'.json?v='+FOX_ASSET_REVISION
export const FOX_ROUTES:Record<ThemeKey,Record<string,{name:string;copy:string}>>={
 'pixel-jrpg':{nearby:{name:'城堡石桥',copy:'沿石桥看看晨光与来往的旅人。'},valley:{name:'月光山谷',copy:'循着星光，去寻找山谷里的故事。'},faraway:{name:'星辰古道',copy:'带着罗盘，走一条更远的路。'}},
 'parchment-journal':{nearby:{name:'林间小径',copy:'收集一片叶子，写进今日手账。'},valley:{name:'河谷古城',copy:'沿河岸走，寄回一张植物明信片。'},faraway:{name:'远山驿站',copy:'带上纸笔，把山路写成故事。'}},
 'animal-crossing':{nearby:{name:'小岛海滩',copy:'在海风里找一枚漂亮的小贝壳。'},valley:{name:'瀑布花谷',copy:'听听流水，看看花开。'},faraway:{name:'海风群岛',copy:'慢慢逛一座尚未去过的小岛。'}},
 'stardew-valley':{nearby:{name:'农场篱边',copy:'看看新芽，和田野打个招呼。'},valley:{name:'向日葵山谷',copy:'带一颗种子，等下一次花开。'},faraway:{name:'秋收小镇',copy:'逛逛小镇集市，捎回一点收获。'}},
}
