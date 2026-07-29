let DATA=[];
async function load(){
    DATA=await fetch("../api/search.json").then(function(r){return r.json();});
    document.getElementById("q").addEventListener("keyup",search);
}
function search(){
    var q=document.getElementById("q").value.toLowerCase();
    var div=document.getElementById("results");
    if(!q){div.innerHTML="";return}
    var matches=DATA.filter(function(e){
        return e.keywords.some(function(k){return k.toLowerCase().includes(q);});
    }).slice(0,50);
    div.innerHTML=matches.map(function(e){
        return `<div class="result" onclick="location.href='${e.url}'">
               <h3>${e.label}</h3>
               ${e.description ? `<p>${e.description}</p>` : ''}
               </div>`;
    }).join("");
}
load();