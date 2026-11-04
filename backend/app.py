from flask import Flask, jsonify, render_template, request, Response
from flask_cors import CORS
import pandas as pd
import gzip
import json
import os
import re
import unicodedata

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

# Faixas de horário: nome -> (hora inicial, hora final), sendo a final exclusiva
FAIXAS = {
    "madrugada": (0, 6),
    "manha": (6, 12),
    "tarde": (12, 18),
    "noite": (18, 24),
}

# Palavras que ficam em minúsculas ao formatar nomes de bairros ("Vila da Penha")
PALAVRAS_MINUSCULAS = {"da", "de", "do", "das", "dos", "e"}

# Por quanto tempo o navegador pode reaproveitar as respostas, em segundos
CACHE_CRIMES = 600       # 10 minutos
CACHE_PONTOS = 86400     # 1 dia (os pontos de ônibus quase não mudam)


# =========================
# FUNÇÕES DE TRATAMENTO
# =========================
def _empacotar(obj):
    """Converte para JSON compacto e comprime (gzip). Só a versão comprimida fica em memória."""
    bruto = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
    return gzip.compress(bruto, compresslevel=6)


def _sem_acento(texto):
    decomposto = unicodedata.normalize("NFD", texto)
    return "".join(c for c in decomposto if unicodedata.category(c) != "Mn")


def _formatar_nome(texto):
    """'VILA MARIANA' -> 'Vila Mariana'; 'JARDIM DA SAUDE' -> 'Jardim da Saude'."""
    palavras = texto.lower().split()
    return " ".join(
        p if (i > 0 and p in PALAVRAS_MINUSCULAS) else p.capitalize()
        for i, p in enumerate(palavras)
    )


def _padronizar_bairros(serie):
    """
    Junta grafias diferentes do mesmo bairro (ex.: 'SÉ' e 'SE'), preferindo a
    grafia com acento, e devolve os nomes formatados.
    """
    brutos = serie.astype(str).str.strip().str.upper()
    melhor = {}  # chave sem acento -> (grafia escolhida, tem acento?)

    for nome in brutos.value_counts().index:  # do mais frequente ao menos frequente
        chave = _sem_acento(nome)
        tem_acento = nome != chave
        atual = melhor.get(chave)
        if atual is None or (tem_acento and not atual[1]):
            melhor[chave] = (nome, tem_acento)

    mapa = {nome: _formatar_nome(melhor[_sem_acento(nome)][0]) for nome in brutos.unique()}
    return brutos.map(mapa)


def _formatar_hora(valor):
    """'19:30:58' -> '19:30'. Se não reconhecer o formato, devolve o texto como veio."""
    texto = str(valor).strip()
    m = re.match(r"^(\d{1,2}):(\d{2})", texto)
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else texto


def _faixa_da_hora(valor):
    """Devolve 'madrugada', 'manha', 'tarde' ou 'noite' (ou '' se a hora for inválida)."""
    try:
        hora = int(float(str(valor).split(":")[0]))
    except ValueError:
        return ""
    for nome, (inicio, fim) in FAIXAS.items():
        if inicio <= hora < fim:
            return nome
    return ""


# =========================
# PREPARO DOS DADOS (roda uma vez, ao iniciar o servidor)
# =========================
def _carregar_crimes():
    """
    Lê o CSV uma única vez e deixa pronta uma resposta para cada combinação
    de ano e faixa de horário. O filtro por bairro é feito no navegador.
    """
    caminho_csv = os.path.join(PROJECT_ROOT, "database", "processed", "crimes_buffer_50m.csv")
    df = pd.read_csv(caminho_csv).fillna("")

    if "bairro" in df.columns:
        df["bairro"] = _padronizar_bairros(df["bairro"])
    if "logradouro" in df.columns:
        df["logradouro"] = df["logradouro"].astype(str).str.strip()

    if "hora" in df.columns:
        faixas = df["hora"].map(_faixa_da_hora).tolist()
        df["hora"] = df["hora"].map(_formatar_hora)
    else:
        faixas = [""] * len(df)

    if "ano" in df.columns:
        anos = df["ano"].astype(str).str.replace(r"\.0$", "", regex=True).tolist()
    else:
        anos = [""] * len(df)

    colunas = [c for c in COLUNAS_CRIMES if c in df.columns]
    registros = df[colunas].to_dict(orient="records")

    # Cada ocorrência entra nas listas do seu ano, da sua faixa e das combinações com "todos"
    grupos = {}
    for ano, faixa, registro in zip(anos, faixas, registros):
        for a in (ano, "todos"):
            for f in ((faixa, "todas") if faixa else ("todas",)):
                grupos.setdefault((a, f), []).append(registro)

    pacotes = {chave: _empacotar(lista) for chave, lista in grupos.items()}

    bairros = []
    if "bairro" in df.columns:
        bairros = sorted({b for b in df["bairro"] if b}, key=_sem_acento)
    pacote_bairros = _empacotar(bairros)

    print(f"Crimes carregados: {len(registros)} | combinações: {len(pacotes)} | bairros: {len(bairros)}")
    return pacotes, pacote_bairros


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
    DADOS_CRIMES, DADOS_BAIRROS = _carregar_crimes()
except Exception as e:
    print("Erro ao carregar crimes:", e)
    DADOS_CRIMES, DADOS_BAIRROS = None, None

try:
    DADOS_PONTOS = _carregar_pontos()
except Exception as e:
    print("Erro ao carregar pontos de ônibus:", e)
    DADOS_PONTOS = None

LISTA_VAZIA = _empacotar([])


def _responder_json(comprimido, cache_segundos):
    """Envia o JSON já pronto, comprimido quando o navegador aceita gzip."""
    if "gzip" in request.headers.get("Accept-Encoding", ""):
        resposta = Response(comprimido, mimetype="application/json")
        resposta.headers["Content-Encoding"] = "gzip"
    else:
        resposta = Response(gzip.decompress(comprimido), mimetype="application/json")
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
# Uso: /api/crimes                          -> todos os anos, todos os horários
#      /api/crimes?ano=2025                 -> só um ano
#      /api/crimes?ano=2025&faixa=noite     -> um ano, só um horário
# Faixas: madrugada (0h-6h), manha (6h-12h), tarde (12h-18h), noite (18h-24h)
@app.route("/api/crimes")
def get_crimes():
    if DADOS_CRIMES is None:
        return jsonify({"erro": "Dados indisponíveis no momento."}), 500

    ano = request.args.get("ano", "todos")
    faixa = request.args.get("faixa", "todas")
    pacote = DADOS_CRIMES.get((ano, faixa), LISTA_VAZIA)
    return _responder_json(pacote, CACHE_CRIMES)


# =========================
# API - BAIRROS (lista para o filtro)
# =========================
@app.route("/api/bairros")
def get_bairros():
    if DADOS_BAIRROS is None:
        return jsonify({"erro": "Dados indisponíveis no momento."}), 500

    return _responder_json(DADOS_BAIRROS, CACHE_CRIMES)


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
