import test from 'node:test';
import assert from 'node:assert/strict';
import {recommend,handler} from './server.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const catalog=[
 {id:'tt0000001',type:'movie',name:'Space',poster:'https://example.com/a.jpg',genres:['Sci-Fi'],rating:8},
 {id:'tt0000002',type:'movie',name:'Romance',poster:'https://example.com/b.jpg',genres:['Romance'],rating:8},
 {id:'tt0000003',type:'movie',name:'Drama',poster:'https://example.com/c.jpg',genres:['Drama'],rating:5}
];
const a={token:'a'.repeat(48),favoriteGenres:['Sci-Fi'],recentlyWatchedGenres:['Sci-Fi']};
const b={token:'b'.repeat(48),favoriteGenres:['Romance'],recentlyWatchedGenres:['Romance']};
test('different recommendations for each profile',()=>{
 assert.equal(recommend(a,catalog,'movie','for-you')[0].id,'tt0000001');
 assert.equal(recommend(b,catalog,'movie','for-you')[0].id,'tt0000002');
});
test('exclude watched and hidden',()=>{
 assert.deepEqual(recommend({...a,watchedIds:['tt0000001'],hiddenIds:['tt0000003']},catalog,'movie','for-you').map(t=>t.id),['tt0000002']);
});
test('filter content type and do not return token',()=>{
 assert.deepEqual(recommend(a,catalog,'series','daily'),[]);
 assert.equal(JSON.stringify(recommend(a,catalog,'movie','daily')).includes(a.token),false);
});
test('different token routes and unknown token rejected',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nuvio-reco-'));
 process.env.RECO_DATA_FILE=path.join(dir,'profiles.json');
 process.env.RECO_CATALOG_FILE=path.join(dir,'catalog.json');
 fs.writeFileSync(process.env.RECO_DATA_FILE,JSON.stringify({profiles:[a,b]}));
 fs.writeFileSync(process.env.RECO_CATALOG_FILE,JSON.stringify(catalog));
 const get=url=>{let status,body;handler({method:'GET',url},{writeHead(c){status=c},end(b){body=JSON.parse(b)}});return {status,body};};
 assert.equal(get(`/p/${a.token}/manifest.json`).status,200);
 assert.equal(get(`/p/${a.token}/catalog/movie/for-you.json`).body.metas[0].id,'tt0000001');
 assert.equal(get(`/p/${b.token}/catalog/movie/for-you.json`).body.metas[0].id,'tt0000002');
 assert.equal(get(`/p/${'f'.repeat(48)}/manifest.json`).status,404);
 fs.rmSync(dir,{recursive:true,force:true});
});
