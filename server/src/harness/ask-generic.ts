/**
 * Words that make a request without naming a topic, per language: `ask` is what to do with something ("explain", "was
 * heißt das") and what kind of thing it is ("diagram", "Absatz"); `fn` is the function words and the names of figures,
 * tables and equations ("Abbildung"). A question made only of them has no topic of its own: with something selected, it
 * asks about that. Raw lower-case tokens, before stemming.
 */
const WORDS: Record<string, { ask: string; fn: string }> = {
  en: {
    ask: `
      explain explains explained explaining explanation describe describes description tell tells show shows shown
      showing mean means meant meaning say says said saying understand clarify elaborate summarize summarise summary
      overview please help give gives detail details thing things something anything work works working look looks
      looking see seeing read okay ok thanks simple simply simpler plain plainly easy easier again brief briefly
      diagram diagrams chart charts graph graphs plot image picture illustration sentence sentences paragraph text
      passage section selection selected region marked highlighted area part purpose point idea role important matter
      matters significance happen happens happening going goes get gets getting don know`,
    fn: 'figure figures fig table tables',
  },
  de: {
    ask: `
      erkläre erklär erklären erklärt erklärung erklaere erklaeren erläutere erläutern fasse zusammen worum geht
      dient passiert funktioniert funktionieren macht machen tut gemeint sehe sehen sieht sinn zweck beschreibe
      beschreib beschreiben beschreibung zeig zeige zeigen zeigt sag sage sagen sagt bedeutet bedeuten bedeutung
      heißt heisst heißen meint meinst meinen versteh verstehe verstehen verständlich hilf helfen bitte gib gibt
      geben kannst kann könntest könnte genauer näher mehr einfach einfacher ausführlicher nochmal nochmals kurz
      zusammenfassung überblick etwas bild grafik diagramm formel satz absatz abschnitt stelle bereich markiert
      markierte markierten ausgewählt ausgewählte auswahl teil`,
    fn: `
      hier dort da dies diese dieser dieses diesem diesen das dass es er sie wir ihr ich du mir mich dir dich uns man
      was wer wie warum wieso weshalb wozu wofür woher wohin wo wann welche welcher welches welchem welchen ist sind
      war waren wird werden wurde hat haben bin bist sein ein eine einen einem einer eines der die den dem des und oder
      aber auch noch nur mal doch denn mit von vom zu zum zur im in an am auf aus bei nach für über um vor als so ob
      nicht kein keine dabei damit dazu davon abbildung abbildungen abb tabelle tabellen gleichung gleichungen`,
  },
  fr: {
    ask: `
      explique expliquer expliquez explication décris décrire montre montrer dis dire signifie signifient veut
      comprends comprendre peux peut pouvez plaît aide aider donne chose choses schéma graphique équation formule
      phrase paragraphe texte passage zone sélection marqué partie fonctionne`,
    fn: `
      ceci cela ça ici là qu que quoi qui quel quelle quels quelles pourquoi comment quand où est sont était être ce
      cet cette ces se le la les un une des du de et ou mais aussi encore en au aux dans sur pour avec par ne pas je tu
      il elle nous vous on me te moi tableau tableaux`,
  },
  es: {
    ask: `
      explica explicar explícame explicación describe describir muestra mostrar di decir dice significa significan
      quiere entiende entender comprender puedes puede ayuda da dar cosa cosas algo diagrama gráfico ecuación fórmula
      frase oración párrafo texto pasaje sección región selección marcado resaltado parte funciona`,
    fn: `
      esto eso aquello aquí allí ahí qué cómo como cuál cuáles quién por porqué porque cuándo cuando dónde donde es
      son está están era ser el los las unos unas lo del pero también más con para su sus mi mis tu tus yo nos figura
      figuras tabla`,
  },
  it: {
    ask: `
      spiega spiegare spiegami spiegazione descrivi descrivere mostra mostrare dimmi dire dici significa significano
      vuol vuole capire capisco puoi può aiuto dai dare dettaglio cosa cose qualcosa diagramma grafico equazione
      formula frase paragrafo testo passaggio sezione regione selezione selezionato evidenziato parte funziona`,
    fn: `
      questo questa questi queste quello quella ciò qui qua lì là che perché perche quale quali chi quando dove è
      sono era essere il lo gli uno dello della dei degli delle ma anche più al allo alla non si suo sua ti io noi
      figure tabella`,
  },
  pt: {
    ask: `
      explique explicação descreve descrever mostra mostrar diz dizer quer entender compreender podes pode poderia
      ajuda ajudar dá coisa coisas algo diagrama gráfico equação fórmula frase parágrafo texto passagem seção secção
      região seleção selecionado destacado parte funciona`,
    fn: `
      isto isso aquilo aqui aí ali porquê qual quais quem onde é são era ser os as uns umas do da dos das mas também
      mais em no na nos nas seu sua meu minha nós figura figuras tabela`,
  },
  nl: {
    ask: `
      leg uit uitleggen uitleg beschrijf beschrijven toon laat zien zeg zeggen betekent bedoel bedoelt begrijp
      begrijpen kun kan kunt alsjeblieft graag help helpen geef geven ding dingen iets grafiek vergelijking formule
      zin alinea tekst sectie gebied selectie geselecteerd gemarkeerd deel werkt`,
    fn: `
      je jij dit dat deze die hier daar wat wie hoe waarom welke wanneer waar zijn wordt worden het de een en of maar
      ook meer op aan met van voor naar niet zich me mij ik wij figuur figuren tabel`,
  },
};

const split = (words: string) => words.split(/\s+/).filter(Boolean);

/** What a question can be made of without naming a topic, in every language learners ask in (matched against the question). */
export const GENERIC = new Set(Object.values(WORDS).flatMap(({ ask, fn }) => [...split(ask), ...split(fn)]));

const FUNCTION = new Map(Object.entries(WORDS).map(([language, { fn }]) => [language, new Set(split(fn))]));

/**
 * The function words of a document's language ("de-DE", "en-US"): what its passages say nothing with. Only that language's
 * are skipped, since a function word of another one ("die", "man", "son") may be a content word in the document.
 */
export const functionWords = (language: string): ReadonlySet<string> =>
  FUNCTION.get(language.split('-')[0].toLowerCase()) ?? new Set();
