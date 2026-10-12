const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom')
const general=fs.readFileSync('src/companions/companion.css','utf8'),toy=fs.readFileSync('src/companions/desktop-life.css','utf8')
for(const order of [[general,toy],[toy,general]]){
 const dom=new JSDOM(`<style>${order.join('\n')}</style><span class="xm-pet-environment"><svg class="xm-toy-art xm-pet-idle-paper"></svg><svg class="xm-toy-art xm-pet-held-toy"></svg></span>`)
 const a=dom.window.getComputedStyle(dom.window.document.querySelector('.xm-pet-idle-paper')),b=dom.window.getComputedStyle(dom.window.document.querySelector('.xm-pet-held-toy'))
 assert.equal(a.width,'18%','Idle toy must not expand to full environment width');assert.equal(a.height,'18%')
 assert.equal(b.width,'38%','Caught toy must keep its small size');assert.equal(b.height,'38%');dom.window.close()
}
console.log('PASS idle and caught toy size in both stylesheet orders')
