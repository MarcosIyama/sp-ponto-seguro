from flask import Flask, jsonify, render_template, request, Response
from flask_cors import CORS
import pandas as pd
import gzip
import json
import os

# Define caminhos absolutos a partir da raiz do projeto
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))

app = Flask(__name__,
            template_folder=os.path.join(PROJECT_ROOT, "frontend", "templates"),
            static_folder=os.path.join(PROJECT_ROOT, "frontend", "static"))
CORS(app)

# =========================
# CONFIGURAÇÕES
# =========================
# Colunas do CSV que o mapa realmente usa (as demais não são enviadas ao navegador)
COLUNAS_CRIMES = ["lat", "lon", "ano", "tipo_crime", "hora", "bairro", "logradouro"]

# Por quanto tempo o navegador pode reaproveitar as respostas, em segundos
CACHE_CRIMES = 600       # 10 minutos
CACHE_PONTOS = 86400     # 1 dia (os pontos de ônibus quase não mudam)


# =========================
# PREPARO DOS DADOS (roda uma vez, ao iniciar o servidor)
# =========================
def _empacotar(obj):
    """Converte para JSON compacto e guarda também a versão comprimida (gzip)."""
    bruto = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
    return bruto, gzip.compress(bruto, compresslevel=6)


def _carregar_crimes():
    """Lê o CSV uma única vez e prepara uma resposta pronta para cada ano."""
    caminho_csv = os.path.join(PROJECT_ROOT, "database", "processed", "crimes_buffer_50m.csv")
    df = pd.read_csv(caminho_csv).fillna("")

    colunas = [c for c in COLUNAS_CRIMES if c in df.columns]
    registros = df[colunas].to_dict(orient="records")

    if "ano" in df.columns:
        anos = df["ano"].astype(str).str.replace(r"\.0$", "", regex=True).tolist()
    else:
        anos = [""] * len(df)

    por_ano = {}
    for ano, registro in zip(anos, registros):
        por_ano.setdefault(ano, []).append(registro)

    pacotes = {"todos": _empacotar(registros)}
    for ano, lista in por_ano.items():
        pacotes[ano] = _empacotar(lista)

    print(f"Crimes carregados: {len(registros)} (anos: {sorted(por_ano)})")
    return pacotes


def _carregar_pontos():
    """Lê o GeoJSON dos pontos de ônibus, remove o que o mapa não usa e comprime."""
    caminho_geojson = os.path.join(PROJECT_ROOT, "database", "geo", "ponto_onibus_corrigido.geojson")
    with open(caminho_geojson, encoding="utf-8") as f:
        geojson = json.load(f)

    for feature in geojson.get("features", []):
        props = feature.get("properties") or {}
        feature["properties"] = (
            {"nm_ponto_onibus": props["nm_ponto_onibus"]} if "nm_ponto_onibus" in props else {}
        )
        geometria = feature.get("geometry") or {}
        if geometria.get("type") == "Point":
            geometria["coordinates"] = [round(c, 6) for c in geometria["coordinates"]]

    print(f"Pontos de ônibus carregados: {len(geojson.get('features', []))}")
    return _empacotar(geojson)


try:
    DADOS_CRIMES = _carregar_crimes()
except Exception as e:
    print("Erro ao carregar crimes:", e)
    DADOS_CRIMES = None

try:
    DADOS_PONTOS = _carregar_pontos()
except Exception as e:
    print("Erro ao carregar pontos de ônibus:", e)
    DADOS_PONTOS = None

LISTA_VAZIA = _empacotar([])


def _responder_json(pacote, cache_segundos):
    """Envia o JSON já pronto, comprimido quando o navegador aceita gzip."""
    bruto, comprimido = pacote
    if "gzip" in request.headers.get("Accept-Encoding", ""):
        resposta = Response(comprimido, mimetype="application/json")
        resposta.headers["Content-Encoding"] = "gzip"
    else:
        resposta = Response(bruto, mimetype="application/json")
    resposta.headers["Vary"] = "Accept-Encoding"
    resposta.headers["Cache-Control"] = f"public, max-age={cache_segundos}"
    return resposta


# =========================
# PÁGINAS
# =========================
@app.route("/")
def home():
    # Renderiza o index.html
    return render_template("index.html")


@app.route("/metodologia")
def metodologia():
    return render_template("metodologia.html")


# =========================
# API - CRIMES
# =========================
# Uso: /api/crimes            -> todos os anos
#      /api/crimes?ano=2025   -> só um ano
@app.route("/api/crimes")
def get_crimes():
    if DADOS_CRIMES is None:
        return jsonify({"erro": "Dados indisponíveis no momento."}), 500

    ano = request.args.get("ano", "todos")
    pacote = DADOS_CRIMES.get(ano, LISTA_VAZIA)
    return _responder_json(pacote, CACHE_CRIMES)


# =========================
# API - PONTOS DE ÔNIBUS
# =========================
@app.route("/api/pontos_onibus")
def pontos_onibus():
    if DADOS_PONTOS is None:
        return jsonify({"erro": "Dados indisponíveis no momento."}), 500

    return _responder_json(DADOS_PONTOS, CACHE_PONTOS)


# =========================
# TESTE API
# =========================
@app.route("/status")
def status():
    return jsonify({"status": "API funcionando"})


# =========================
# RODAR SERVIDOR
# =========================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
