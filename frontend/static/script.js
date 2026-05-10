// =========================
// 🗺️ MAPA
// =========================
const map = L.map("map").setView([-23.55, -46.63], 11);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
}).addTo(map);


// =========================
// 📦 VARIÁVEIS
// =========================
let todosCrimes = [];
let pontosOnibus = [];

let camadaCrimes = L.layerGroup().addTo(map);


// =========================
// 📏 DISTÂNCIA
// =========================
function calcularDistancia(lat1, lon1, lat2, lon2) {

  const R = 6371000;

  const toRad = (deg) => deg * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}


// =========================
// 📅 FILTRO
// =========================
const filtro = document.getElementById("filtro");

if (filtro) {

  filtro.addEventListener("change", (e) => {

    console.log("ANO:", e.target.value);

    desenharCrimes(e.target.value);

  });

}


// =========================
// 🚌 PONTOS DE ÔNIBUS
// =========================
fetch("http://127.0.0.1:5000/api/pontos_onibus")

  .then(res => res.json())

  .then(geojson => {

    geojson.features.forEach(feature => {

      const [lon, lat] = feature.geometry.coordinates;

      pontosOnibus.push({
        lat: parseFloat(lat),
        lon: parseFloat(lon)
      });

      L.circleMarker([lat, lon], {
        radius: 5,
        color: "green"
      })
      .addTo(map)
      .bindPopup(`
        <b>${feature.properties?.nm_ponto_onibus || "Ponto de ônibus"}</b>
      `);

    });

    console.log("Pontos carregados:", pontosOnibus.length);

    carregarCrimes();

  })

  .catch(err => console.error("Erro ônibus:", err));


// =========================
// 🔴 CARREGAR CRIMES
// =========================
function carregarCrimes() {

  fetch("http://127.0.0.1:5000/api/crimes")

    .then(res => res.json())

    .then(dados => {

      todosCrimes = dados;

      console.log("Crimes carregados:", todosCrimes.length);

      desenharCrimes("todos");

    })

    .catch(err => console.error("Erro crimes:", err));

}


// =========================
// 🔁 DESENHAR CRIMES
// =========================
function desenharCrimes(anoSelecionado) {

  camadaCrimes.clearLayers();

  let contador = 0;

  todosCrimes.forEach(crime => {

    const lat = parseFloat(crime.lat);
    const lon = parseFloat(crime.lon);

    if (isNaN(lat) || isNaN(lon)) return;

    // filtro por ano
    if (
      anoSelecionado !== "todos" &&
      String(crime.ano) !== String(anoSelecionado)
    ) {
      return;
    }

    // buffer
    let perto = false;

    for (let ponto of pontosOnibus) {

      const dist = calcularDistancia(
        lat,
        lon,
        ponto.lat,
        ponto.lon
      );

      // BUFFER
      if (dist <= 1000) {

        perto = true;

        break;

      }

    }

    // desenhar crime
    if (perto) {

      contador++;

      L.circleMarker([lat, lon], {
        radius: 4,
        color: "red"
      })
      .addTo(camadaCrimes)
      .bindPopup(`
        <b>Tipo:</b> ${crime.tipo_crime || "N/A"}<br>
        <b>Ano:</b> ${crime.ano}<br>
        <b>Bairro:</b> ${crime.bairro || "N/A"}
      `);

    }

  });

  console.log("Crimes filtrados:", contador);

}