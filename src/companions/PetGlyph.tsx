type Glyph='talk'|'travel'|'bag'|'pet'|'snack'|'brush'|'walk'|'game'|'dress'|'memory'|'settings'|'back'|'close'
const paths:Record<Glyph,string>={
 talk:'M5 4h14v11H11l-5 4v-4H5zM8 8h8M8 11h5',
 travel:'M12 3l8 17-8-5-8 5zM12 3v12',
 bag:'M7 7V5a5 5 0 0 1 10 0v2M5 7h14l1 13H4zM8 11h8M9 15h6',
 pet:'M5 16c-2-3-1-6 2-6l3 3V5a2 2 0 0 1 4 0v6l2-2c2-2 5 0 3 3l-3 6c-3 4-8 3-11-2',
 snack:'M5 7l4-3 4 1 5-1 2 5-2 10H6zM9 10h.01M14 8h.01M15 14h.01M10 16h.01',
 brush:'M4 5h16v7H4zM6 8v4M9 8v4M12 8v4M15 8v4M18 8v4M10 12v7a2 2 0 0 0 4 0v-7',
 walk:'M8 4l3 3-2 5-4-2zM15 12l3 3-2 5-4-2zM6 15l2 1M15 5l2 1',
 game:'M3 5h8v13H3zM13 7h8v13h-8zM5 11l2-2 2 2-2 2zM15 13l2-2 2 2-2 2z',
 dress:'M8 4l4 2 4-2 5 5-4 3v8H7v-8l-4-3zM8 4c0 5 8 5 8 0',
 memory:'M4 4h7l1 2 1-2h7v16h-7l-1 1-1-1H4zM12 6v15M7 8h2M7 12h2M15 8h2M15 12h2',
 settings:'M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2zM12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6',
 back:'M15 5l-7 7 7 7',
 close:'M6 6l12 12M18 6L6 18',
}
export function PetGlyph({name,size=22}:{name:Glyph;size?:number}){
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>
}

