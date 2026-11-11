# Teoria de Resposta ao Item (TRI) — Explicação e Funcionamento no ENEM

A **Teoria de Resposta ao Item (TRI)** é o modelo estatístico e matemático utilizado pelo INEP para calcular as notas das provas objetivas do ENEM (Ciências da Natureza, Ciências Humanas, Linguagens e Matemática). 

Diferentemente da Teoria Clássica dos Testes (onde cada questão tem o mesmo peso e a nota é uma simples contagem de acertos), a TRI avalia o candidato com base no **padrão de coerência** das respostas e nas **características técnicas de cada questão** (itens).

---

## 1. Os Três Parâmetros dos Itens
Cada questão do ENEM possui uma "calibração" prévia obtida através de pré-testes, sendo definida por três parâmetros estatísticos:

1. **Parâmetro $a$ (Discriminação):** 
   - Mede a capacidade da questão de diferenciar candidatos que possuem maior conhecimento daqueles que possuem menor conhecimento sobre a habilidade exigida.
2. **Parâmetro $b$ (Dificuldade):** 
   - Representa o nível de complexidade da questão na escala da proficiência. Quanto mais difícil a questão, maior o valor de $b$.
3. **Parâmetro $c$ (Acerto ao Acaso / Chute):** 
   - Estima a probabilidade de um candidato com baixo conhecimento acertar a questão puramente no chute (comum em testes de múltipla escolha com 5 alternativas, onde o valor costuma se aproximar de $0,20$).

---

## 2. A Coerência e o "Efeito Chute"
Como o ENEM busca medir o conhecimento real (o chamado *traço latente* ou proficiência $\theta$), o sistema analisa se o padrão de acertos do candidato faz sentido pedagógico:
- **Respostas Coerentes:** Se um aluno acerta as questões fáceis, médias e difíceis de forma progressiva, a TRI atribui uma pontuação alta e proporcional aos seus acertos.
- **Incoerência / Chute:** Se um aluno erra diversas questões fáceis, mas acerta questões muito difíceis, o modelo matemático interpreta que o acerto na questão difícil foi casual (chute). Nesse caso, a pontuação daquela questão difícil é severamente atenuada.

> **Importante:** A TRI **não** penaliza o aluno subtraindo pontos por errar (você não perde pontos por chutar). O que ocorre é que o sistema não concede o bônus de acerto de uma questão difícil se o candidato não demonstrou o domínio das competências básicas (fáceis) correspondentes.

---

## 3. Vantagens da TRI
- **Comparabilidade entre Anos:** Como as questões são calibradas em uma escala fixa de proficiência, é possível comparar o desempenho de estudantes entre diferentes edições do ENEM (uma prova mais difícil não resulta em notas globalmente menores para todos, pois a dificuldade dos itens é compensada no cálculo).
- **Independência do Grupo:** A nota de um candidato depende exclusivamente do seu próprio padrão de respostas e do nível das questões que acertou, e não da média ou desempenho dos demais concorrentes daquela edição.
