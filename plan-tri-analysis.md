# Planejamento: Seção de Análise Avançada de TRI (ENEM)

Este documento planeja a implementação de um painel de **Análise de TRI (Teoria de Resposta ao Item)** dentro do aplicativo offline do ENEM 2025, integrando os dados de resultados, participantes e itens de prova.

---

## 1. Fontes de Dados Envolvidas
Para realizar esta análise completa, a aplicação utilizará:
- **`RESULTADOS.csv`**: Para cruzar os acertos (`TX_RESPOSTAS_*` vs `TX_GABARITO_*`), notas finais (`NU_NOTA_*`) e presença dos candidatos.
- **`ITENS_PROVA.csv`**: Contém os parâmetros técnicos de cada questão:
  - `CO_ITEM` / `CO_POSICAO`: Identificação da questão.
  - `SG_AREA`: Área do conhecimento (CN, CH, LC, MT).
  - `TX_GABARITO`: Gabarito oficial.
  - `NU_PARAM_A` (Discriminação), `NU_PARAM_B` (Dificuldade), `NU_PARAM_C` (Acerto ao Acaso).
  - `CO_PROVA`: Código do caderno de prova.

---

## 2. Métricas e Análises Calculadas na Seção
A seção de TRI exibirá os seguintes blocos interativos:

### A. Visão Geral por Área (CN, CH, LC, MT)
- **Média de Proficiência ($\theta$)**: Nota média calculada na área.
- **Taxa Global de Acerto**: Percentual médio de acertos nas questões daquela área na amostra carregada.

### B. Ranking de Questões (Os Extremos)
- **Questões Mais Fáceis vs. Mais Difíceis**: Baseado no parâmetro de dificuldade ($b$) e no percentual real de acertos na base carregada.
- **Questões com Maior Poder de Discriminação ($a$)**: Quais itens melhor diferenciaram os alunos com notas altas dos alunos com notas baixas.
- **Análise de "Pegadinhas" / Chutes Elevados ($c$)**: Questões onde a probabilidade de acerto ao acaso foi alta ou que apresentaram distratores muito fortes.

### C. Curva Característica do Item (CCI) / Simulador Visual
- Gráfico interativo simples em Canvas/SVG mostrando a probabilidade de acerto de uma questão em função da proficiência do aluno (baseado nos parâmetros $a, b, c$ do arquivo `ITENS_PROVA.csv`).

---

## 3. Arquitetura e Execução (Worker & UI)
1. **Processamento no Web Worker**:
   - O worker processará `ITENS_PROVA.csv` e fará o cruzamento com o volume de respostas do `RESULTADOS.csv` (quando carregado o pacote completo / ZIP).
2. **Interface (UI)**:
   - Nova aba ou painel "Análise TRI" no layout principal.
   - Tabelas limpas e responsivas com paginação/filtros por área do conhecimento e caderno de prova.
   - Gráficos em SVG puro (mantendo a restrição de zero dependências externas).
