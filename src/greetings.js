(function () {
const greetings = {
  ro: {
    language: "Romana",
    items: [
      "La multi ani!",
      "40 e noul 25.",
      "Tortul confirma: esti legendara.",
      "Azi ai voie la tot ce-i bun.",
      "Mai multa lumina, mai putine sedinte.",
      "Urmeaza partea cea mai frumoasa.",
      "Nivel nou de stralucire deblocat.",
      "Sa-ti fie anul cu extra frisca."
    ]
  },
  en: {
    language: "English",
    items: [
      "Happy birthday!",
      "40 is the new 25.",
      "The best is yet to come.",
      "Cake first, questions later.",
      "New level unlocked.",
      "May your snacks be elite.",
      "Today, the calendar works for you.",
      "More joy, fewer boring meetings."
    ]
  },
  fr: {
    language: "Francais",
    items: [
      "Joyeux anniversaire !",
      "40, c'est le nouveau 25.",
      "Le meilleur arrive.",
      "Gateau d'abord, logique apres.",
      "Niveau superieur debloque.",
      "Aujourd'hui, le calendrier t'obeit.",
      "Plus de joie, moins de reunions.",
      "Que l'annee croustille de surprises."
    ]
  },
  es: {
    language: "Espanol",
    items: [
      "Feliz cumpleanos!",
      "40 es el nuevo 25.",
      "Lo mejor esta por venir.",
      "Primero pastel, luego preguntas.",
      "Nuevo nivel desbloqueado.",
      "Hoy manda tu sonrisa.",
      "Mas alegria, menos reuniones.",
      "Que tu ano venga con papas extra."
    ]
  },
  it: {
    language: "Italiano",
    items: [
      "Buon compleanno!",
      "40 e il nuovo 25.",
      "Il meglio deve arrivare.",
      "Prima la torta, poi il resto.",
      "Nuovo livello sbloccato.",
      "Oggi comanda il tuo sorriso.",
      "Piu gioia, meno riunioni.",
      "Che l'anno porti patatine extra."
    ]
  },
  he: {
    language: "Hebrew",
    items: [
      { text: "יום הולדת שמח!", subtitle: "Yom huledet sameach!" },
      { text: "40 זה ה-25 החדש.", subtitle: "Arba'im ze ha-esrim ve-chamesh hechadash." },
      { text: "הטוב עוד לפנייך.", subtitle: "Hatov od lefanayich." },
      { text: "קודם עוגה, אחר כך שאלות.", subtitle: "Kodem uga, achar kach she'elot." },
      { text: "נפתח שלב חדש.", subtitle: "Niftach shlav chadash." },
      { text: "היום החיוך שלך מנהל הכל.", subtitle: "Hayom hachiyuch shelach menahel hakol." },
      { text: "יותר שמחה, פחות ישיבות.", subtitle: "Yoter simcha, pachot yeshivot." },
      { text: "שנה עם הפתעות וצ'יפס נוסף.", subtitle: "Shana im hafta'ot vechips nosaf." }
    ]
  },
  el: {
    language: "Greek",
    items: [
      "Χρονια πολλα!",
      "Τα 40 ειναι τα νεα 25.",
      "Τα καλυτερα ερχονται.",
      "Πρωτα τουρτα, μετα ερωτησεις.",
      "Νεο επιπεδο ξεκλειδωθηκε.",
      "Σημερα χαμογελαει το ημερολογιο.",
      "Περισσοτερη χαρα, λιγοτερα meetings.",
      "Να ερθει χρονια με εξτρα πατατες."
    ]
  }
};

function randomGreeting() {
  const groups = Object.values(greetings);
  const group = groups[Math.floor(Math.random() * groups.length)];
  const item = group.items[Math.floor(Math.random() * group.items.length)];
  return {
    language: group.language,
    value: item,
  };
}

const easterTranslations = [
  {
    language: "Romana",
    title: "La multi ani!",
    subtitle: "Cel mai bun cadou este prezentul. Aici sunt cateva cadouri trecute care traiesc ca amintiri."
  },
  {
    language: "English",
    title: "Happy birthday!",
    subtitle: "The best present is the present. Here are some of the past presents that live as memories."
  },
  {
    language: "Francais",
    title: "Joyeux anniversaire !",
    subtitle: "Le plus beau cadeau, c'est le present. Voici quelques cadeaux passes qui vivent comme des souvenirs."
  },
  {
    language: "Espanol",
    title: "Feliz cumpleanos!",
    subtitle: "El mejor regalo es el presente. Aqui hay algunos regalos pasados que viven como recuerdos."
  },
  {
    language: "Italiano",
    title: "Buon compleanno!",
    subtitle: "Il regalo migliore e il presente. Ecco alcuni regali passati che vivono come ricordi."
  },
  {
    language: "Hebrew",
    title: "יום הולדת שמח!",
    subtitle: "המתנה הכי טובה היא ההווה. הנה כמה מתנות מהעבר שחיות כזכרונות.",
    roman: "Yom huledet sameach! Ha-matana hachi tova hi ha-hove. Hine kama matanot meha-avar shechayot kezichronot."
  },
  {
    language: "Greek",
    title: "Χρονια πολλα!",
    subtitle: "Το καλυτερο δωρο ειναι το παρον. Εδω ειναι μερικα παλια δωρα που ζουν σαν αναμνησεις."
  }
];

function randomEasterTranslation() {
  return easterTranslations[Math.floor(Math.random() * easterTranslations.length)];
}

window.VaultGreetings = {
  greetings,
  randomGreeting,
  randomEasterTranslation,
};
})();
