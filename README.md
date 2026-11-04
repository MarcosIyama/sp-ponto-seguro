<p align="center">
  <img src="frontend/static/logo.png" alt="SP Ponto Seguro" width="280">
</p>

<h1 align="center">SP Ponto Seguro</h1>

<p align="center">
  Mapa interativo de roubos de celulares registrados a até 50 metros de pontos de ônibus em São Paulo.
  <br>
  <a href="https://sp-ponto-seguro.onrender.com/"><strong>Acessar o site</strong></a>
</p>

---

## Sobre o projeto

Dados públicos de segurança nem sempre são fáceis de compreender. O **SP Ponto Seguro** transforma registros de roubos de celulares da SSP-SP em um mapa que mostra **onde essas ocorrências se concentram perto de pontos de ônibus**, para que qualquer pessoa possa explorá-las por ano, horário, bairro e endereço.

O projeto é **descritivo**: não faz previsões, não atribui risco a pessoas e não substitui as informações oficiais de segurança pública.

Foi desenvolvido como **projeto integrador da UNIVESP**. A primeira versão exibia pontos de ônibus e ocorrências como marcadores, com filtro por ano. A versão atual reorganizou a visualização em torno de um mapa de calor e acrescentou filtros, busca por endereço e uma página de metodologia.

## Funcionalidades

- **Mapa de calor** da concentração de ocorrências, com legenda de cores (do amarelo claro ao vinho).
- **Ocorrências individuais** como pontos vermelhos, com popup (tipo, ano, hora, bairro e logradouro) e **pontos de ônibus** em azul.
- **Visualização automática:** calor com o mapa afastado e pontos com o mapa aproximado (a partir do zoom 15). Também é possível escolher só o calor ou só os pontos.
- **Filtros** por ano, faixa de horário (manhã, tarde, noite e madrugada) e bairro, com atualização sem recarregar a página.
- **Busca por endereço** limitada à região de São Paulo, usando o Nominatim (OpenStreetMap).
- **Página de metodologia** explicando fontes, tratamento dos dados, leitura do mapa de calor e limitações.
- **Desempenho:** desenho em Canvas, apenas da área visível, respostas comprimidas (gzip) e pontos de ônibus carregados só quando necessários.

## Como os dados são tratados

1. **Fontes:** registros de roubos de celulares da [SSP-SP](https://www.ssp.sp.gov.br/estatistica/dados-abertos) (2023 a fevereiro de 2026) e pontos de ônibus do [GeoSampa](https://geosampa.prefeitura.sp.gov.br).
2. **Limpeza (Python e Pandas):** seleção de colunas, filtro por município e categoria, remoção de registros inválidos, conversão de coordenadas e junção dos anos em uma única base.
3. **Raio de 50 metros:** a distância geográfica entre cada ocorrência e os pontos de ônibus é calculada com a biblioteca Geopy, e só ficam as ocorrências a até 50 m de algum ponto. O raio foi uma escolha do grupo.
4. **Ao iniciar o servidor:** os dados são lidos uma única vez, os nomes de bairros são padronizados (por exemplo, "SÉ" e "SE") e as respostas são preparadas por ano e faixa de horário.

Mais detalhes na página **Metodologia** do site.

## Tecnologias

| Camada | Tecnologias |
|---|---|
| Tratamento de dados | Python, Pandas, Geopy |
| Backend | Flask, Flask-CORS |
| Frontend | HTML, CSS e JavaScript (sem framework) |
| Mapa | Leaflet, Leaflet.heat, OpenStreetMap |
| Hospedagem e versionamento | Render, Git e GitHub |

## Estrutura do repositório

```
sp-ponto-seguro/
├── backend/
│   └── app.py              # servidor Flask: páginas e API
├── frontend/
│   ├── templates/          # base.html, index.html, metodologia.html
│   └── static/             # script.js, style.css, logos e ícones
├── database/
│   ├── processed/          # CSV tratado (crimes_buffer_50m.csv)
│   └── geo/                # GeoJSON dos pontos de ônibus
├── scripts/                # limpeza, conversão de GeoJSON e criação do banco
├── requirements.txt        # dependências do site (o que o Render instala)
├── requirements-dev.txt    # dependências dos scripts de tratamento de dados
└── README.md
```

## API

| Rota | Descrição |
|---|---|
| `GET /` | Página inicial com o mapa |
| `GET /metodologia` | Página de metodologia |
| `GET /api/crimes` | Ocorrências. Parâmetros opcionais: `ano` (ex.: `2025`) e `faixa` (`manha`, `tarde`, `noite` ou `madrugada`) |
| `GET /api/bairros` | Lista de bairros para o filtro |
| `GET /api/pontos_onibus` | Pontos de ônibus em GeoJSON |
| `GET /status` | Verificação de funcionamento |

## Como executar localmente

Pré-requisito: Python 3 instalado. Os comandos abaixo são para o PowerShell (Windows).

```powershell
# 1. Clonar o repositório
git clone https://github.com/MarcosIyama/sp-ponto-seguro.git
cd sp-ponto-seguro

# 2. Criar e ativar um ambiente virtual
python -m venv venv
.\venv\Scripts\Activate.ps1

# 3. Instalar as dependências do site
pip install -r requirements.txt

# 4. Iniciar o servidor
python backend/app.py
```

Depois, abra **http://localhost:5000** no navegador. As páginas dependem do Flask: não abra os arquivos de `frontend/templates` direto no navegador nem por extensões como o Live Server.

> Em Linux ou macOS, ative o ambiente com `source venv/bin/activate`.

Para rodar os scripts da pasta `scripts/` (tratamento de dados e análise espacial), instale também as dependências de desenvolvimento, que incluem GeoPandas, Geopy e Shapely:

```powershell
pip install -r requirements-dev.txt
```

## Publicação (Render)

O site é publicado no [Render](https://render.com), integrado ao GitHub: cada atualização da branch `main` gera uma nova publicação. Configuração do serviço web:

| Campo | Valor |
|---|---|
| Build Command | `pip install -r requirements.txt` |
| Start Command | `gunicorn backend.app:app --workers 1 --threads 4 --timeout 120` |
| Health Check Path | `/status` |

O servidor lê e prepara todos os dados ao iniciar (cerca de 3 segundos) e os mantém na memória, por isso usa um único processo com várias threads: cada processo adicional carregaria uma cópia dos dados. No plano gratuito, o serviço "dorme" após alguns minutos sem acessos, e o primeiro acesso depois disso demora mais.

## Limitações

- Os dados são registros oficiais, e não o crime real: há subnotificação e diferenças de registro entre territórios.
- Locais com mais pessoas e mais pontos de ônibus tendem a mostrar mais ocorrências. O mapa não é uma taxa por população nem por fluxo de passageiros.
- Imprecisões de georreferenciamento na base podem afetar a posição das manchas.
- Os dados de 2026 vão só até fevereiro.
- O ano usado no filtro pode não coincidir com a data da ocorrência, pois os dados públicos nem sempre são padronizados.
- A base cobre apenas roubos de celulares.

## Próximos passos

- Padronizar o campo de ano na base.
- Usar o banco de dados SQLite (já previsto no projeto) como fonte da API.
- Calcular um índice de concentração de ocorrências por ponto de ônibus, com estimativa de densidade de kernel (KDE).
- Atualizar os dados de forma automatizada.
- Normalizar por fluxo de passageiros ou população.

## Fontes e créditos

- Dados criminais: Secretaria da Segurança Pública do Estado de São Paulo (SSP-SP).
- Pontos de ônibus: GeoSampa, Prefeitura de São Paulo.
- Mapa de fundo e busca de endereços: © colaboradores do [OpenStreetMap](https://www.openstreetmap.org/copyright).
- Mapa interativo: [Leaflet](https://leafletjs.com) e [Leaflet.heat](https://github.com/Leaflet/Leaflet.heat).
