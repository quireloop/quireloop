const ARTICLE = (name) => `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}

\\title{${name}}
\\author{Your Name}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
Write your abstract here.
\\end{abstract}

\\section{Introduction}
Start writing here.

\\section{Conclusion}

\\end{document}
`;

const REPORT = (name) => `\\documentclass{report}
\\usepackage[utf8]{inputenc}

\\title{${name}}
\\author{Your Name}
\\date{\\today}

\\begin{document}
\\maketitle
\\tableofcontents

\\chapter{Introduction}
Start writing here.

\\chapter{Conclusion}

\\end{document}
`;

const BEAMER = (name) => `\\documentclass{beamer}
\\usetheme{Madrid}

\\title{${name}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\frame{\\titlepage}

\\begin{frame}{Outline}
\\tableofcontents
\\end{frame}

\\begin{frame}{Introduction}
Start writing here.
\\end{frame}

\\end{document}
`;

const CV = (name) => `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=1in]{geometry}
\\pagestyle{empty}

\\begin{document}

\\begin{center}
{\\LARGE \\textbf{${name}}}\\\\[4pt]
email@example.com \\quad | \\quad (555) 555-5555 \\quad | \\quad City, Country
\\end{center}

\\section*{Education}
\\textbf{Degree}, Institution --- Year

\\section*{Experience}
\\textbf{Role}, Organization --- Year--Year
\\begin{itemize}
  \\item Describe your work here.
\\end{itemize}

\\section*{Skills}
List your skills here.

\\end{document}
`;

const BLANK = (name) => `\\documentclass{article}
\\begin{document}

Hello, ${name}!

\\end{document}
`;

export const TEMPLATES = {
  blank: { label: 'Blank', render: BLANK },
  article: { label: 'Article', render: ARTICLE },
  report: { label: 'Report', render: REPORT },
  beamer: { label: 'Beamer Presentation', render: BEAMER },
  cv: { label: 'CV / Resume', render: CV },
};

export function templateContent(templateId, projectName) {
  const template = TEMPLATES[templateId] ?? TEMPLATES.blank;
  return template.render(projectName);
}
