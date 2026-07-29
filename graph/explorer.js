let svg, g, simulation;
let link, node, label, glow;
let graphData, nodeMap;
let tooltip;
let width, height;

async function load() {
    try {
        const res = await fetch("graph.json");
        graphData = await res.json();
    } catch(e) {
        console.error("Erro ao carregar graph.json:", e);
        return;
    }

    nodeMap = {};
    graphData.nodes.forEach(function(n) { nodeMap[n.id] = n; });

    var validEdges = graphData.edges.filter(function(e) {
        return nodeMap[e.source] && nodeMap[e.target];
    });
    graphData.edges = validEdges;

    console.log("Nós:", graphData.nodes.length, "Arestas válidas:", graphData.edges.length);

    setupSVG();
    buildSidebar();
    createSimulation();
    setupZoom();
    setupResize();
}

function setupSVG() {
    svg = d3.select("#graph");
    var rect = svg.node().getBoundingClientRect();
    width = rect.width || 978;
    height = rect.height || 644;
    svg.attr("viewBox", [0, 0, width, height]);
    g = svg.append("g");
    svg.append("rect")
        .attr("width", width)
        .attr("height", height)
        .attr("fill", "none")
        .attr("pointer-events", "none");
    tooltip = d3.select("body").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0);
}

function countConnections(id) {
    var count = 0;
    graphData.edges.forEach(function(e) {
        // Verifica se a relação envolve este nó (seja como source ou target)
        if (e.source === id || e.target === id || 
           (e.source.id && e.source.id === id) || 
           (e.target.id && e.target.id === id)) {
            count++;
        }
    });
    return count;
}

function colorByDegree(id) {
    var degree = countConnections(id);
    if (degree === 0) return "#7A5CFF";
    if (degree <= 2) return "#00D1FF";
    if (degree <= 5) return "#00FFA3";
    var t = Math.min(1, degree / 15);
    return d3.interpolateLab("#00D1FF", "#00FFA3")(t);
}

function createSimulation() {
    link = g.append("g")
        .selectAll("line")
        .data(graphData.edges)
        .join("line")
        .attr("class", "link-line")
        .attr("stroke", "#7A5CFF")
        .attr("stroke-opacity", 0.3)
        .attr("stroke-width", 1.2);

    glow = g.append("g")
        .selectAll("circle")
        .data(graphData.nodes)
        .join("circle")
        .attr("class", "node-glow")
        .attr("r", 18)
        .attr("fill", "rgba(0,209,255,0.08)");

    node = g.append("g")
        .selectAll("circle")
        .data(graphData.nodes)
        .join("circle")
        .attr("class", "node-circle")
        .attr("r", function(d) { return Math.max(5, Math.min(12, 4 + Math.sqrt(countConnections(d.id)) * 2)); })
        .attr("fill", function(d) { return colorByDegree(d.id); })
        .attr("stroke", "rgba(255,255,255,0.3)")
        .attr("stroke-width", 1.5)
        .call(d3.drag()
            .on("start", dragStarted)
            .on("drag", dragged)
            .on("end", dragEnded))
        .on("mouseenter", showTooltip)
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip)
        .on("click", function(event, d) {
            window.location.href = `entity/${d.id}/index.html`;
        });

    label = g.append("g")
        .selectAll("text")
        .data(graphData.nodes)
        .join("text")
        .attr("class", "node-label")
        .attr("dx", function(d) { return Math.max(5, Math.min(12, 4 + Math.sqrt(countConnections(d.id)) * 2)) + 6; })
        .attr("dy", 4)
        .text(function(d) { return d.label.length > 30 ? d.label.slice(0, 28) + "\u2026" : d.label; });

    if (graphData.edges.length === 0) {
        graphData.nodes.forEach(function(d, i) {
            var angle = (i / graphData.nodes.length) * 2 * Math.PI;
            var radius = Math.min(width, height) * 0.35;
            d.x = width / 2 + radius * Math.cos(angle);
            d.y = height / 2 + radius * Math.sin(angle);
        });
        ticked();
        return;
    }

    simulation = d3.forceSimulation(graphData.nodes)
        .force("link", d3.forceLink(graphData.edges)
            .id(function(d) { return d.id; })
            .distance(200)
            .strength(0.4))
        .force("charge", d3.forceManyBody()
            .strength(-500)
            .distanceMax(1000))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(50))
        .alphaDecay(0.02)
        .alpha(1)
        .on("tick", ticked);
}

function ticked() {
    link
        .attr("x1", function(d) { return d.source.x || 0; })
        .attr("y1", function(d) { return d.source.y || 0; })
        .attr("x2", function(d) { return d.target.x || 0; })
        .attr("y2", function(d) { return d.target.y || 0; });
    glow
        .attr("cx", function(d) { return d.x || 0; })
        .attr("cy", function(d) { return d.y || 0; });
    node
        .attr("cx", function(d) { return d.x || 0; })
        .attr("cy", function(d) { return d.y || 0; });
    label
        .attr("x", function(d) { return d.x || 0; })
        .attr("y", function(d) { return d.y || 0; });
}

function dragStarted(event, d) {
    if (!event.active && simulation) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragEnded(event, d) {
    if (!event.active && simulation) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

function showTooltip(event, d) {
    let html = `<div class="tooltip-title">${escHtml(d.label)}</div>`;
    if (d.description) html += `<div class="tooltip-desc">${escHtml(d.description)}</div>`;
    html += `<div class="tooltip-id">${d.id} · ${countConnections(d.id)} conexões</div>`;
    tooltip.style("opacity", 1).html(html);
}

function moveTooltip(event) {
    tooltip
        .style("left", (event.clientX + 16) + "px")
        .style("top", (event.clientY - 10) + "px");
}

function hideTooltip() {
    tooltip.style("opacity", 0);
}

function escHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function setupZoom() {
    var zoom = d3.zoom()
        .scaleExtent([0.1, 5])
        .on("zoom", function(event) {
            g.attr("transform", event.transform);
        });
    svg.call(zoom);
    svg.call(zoom.transform, d3.zoomIdentity);
    document.getElementById("zoom-in").onclick = function() {
        svg.transition().duration(300).call(zoom.scaleBy, 1.3);
    };
    document.getElementById("zoom-out").onclick = function() {
        svg.transition().duration(300).call(zoom.scaleBy, 0.7);
    };
    document.getElementById("zoom-reset").onclick = function() {
        svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
    };
}

function setupResize() {
    window.addEventListener("resize", function() {
        var rect = svg.node().getBoundingClientRect();
        width = rect.width || 978;
        height = rect.height || 644;
        svg.attr("viewBox", [0, 0, width, height]);
        if (simulation) {
            simulation.force("center", d3.forceCenter(width / 2, height / 2));
            simulation.alpha(0.3).restart();
        }
    });
}

function buildSidebar() {
    var div = document.getElementById("entity-list");
    div.innerHTML = "";
    document.getElementById("stats").innerHTML =
        `${graphData.nodes.length} entidades · ${graphData.edges.length} relações`;
        
    graphData.nodes
        .sort(function(a, b) { return a.label.localeCompare(b.label); })
        .forEach(function(n) {
            var e = document.createElement("div");
            e.className = "entity";
            e.textContent = n.label;
            e.onclick = function() { window.location.href = `entity/${n.id}/index.html`; };
            div.appendChild(e);
        });
}

document.getElementById("search").addEventListener("keyup", function() {
    var q = this.value.toLowerCase();
    document.querySelectorAll(".entity").forEach(function(e) {
        e.style.display = e.textContent.toLowerCase().includes(q) ? "block" : "none";
    });
});

load();