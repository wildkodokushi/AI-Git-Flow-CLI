import { UserError } from './errors.js';
import { HttpError, request } from './http.js';

export const LICENSES = {
  'mit': { description: 'Простая и самая популярная: свободное использование, нужно лишь сохранить копирайт.' },
  'apache-2.0': { description: 'Как MIT, плюс явная патентная лицензия. Подходит для крупных проектов.' },
  'bsd-3-clause': { description: 'Близка к MIT, запрещает использовать имя автора для рекламы производных продуктов.' },
  'bsd-2-clause': { description: 'Упрощённая BSD, по смыслу близка к MIT.' },
  'isc': { description: 'Очень короткая, по смыслу эквивалент MIT.' },
  'gpl-3.0': { description: 'Строгий копилефт: производные работы обязаны оставаться открытыми под GPL.' },
  'agpl-3.0': { description: 'GPL плюс требование открывать код сетевых сервисов.' },
  'lgpl-3.0': { description: 'Слабый копилефт для библиотек: их можно подключать к закрытому коду.' },
  'mpl-2.0': { description: 'Копилефт на уровне отдельных файлов.' },
  'unlicense': { description: 'Общественное достояние: никаких условий.' },
};

export const ALIASES = {
  apache: 'apache-2.0', apache2: 'apache-2.0', gpl: 'gpl-3.0', agpl: 'agpl-3.0', lgpl: 'lgpl-3.0',
  mpl: 'mpl-2.0', bsd: 'bsd-3-clause', 'bsd-3': 'bsd-3-clause', 'bsd-2': 'bsd-2-clause',
};

// Short licenses are embedded so they work offline. Longer texts come from the GitHub licenses API.
const TEMPLATES = {
  'mit': `MIT License

Copyright (c) [year] [fullname]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  'bsd-3-clause': `BSD 3-Clause License

Copyright (c) [year], [fullname]
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`,
  'bsd-2-clause': `BSD 2-Clause License

Copyright (c) [year], [fullname]
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`,
  'isc': `ISC License

Copyright (c) [year], [fullname]

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
`,
  'unlicense': `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
`,
};

export function normalizeLicenseKey(input) {
  const key = String(input ?? '').trim().toLowerCase();
  const resolved = ALIASES[key] ?? key;
  if (!Object.hasOwn(LICENSES, resolved)) {
    throw new UserError(`Неизвестный тип лицензии "${input}". Доступно: ${Object.keys(LICENSES).join(', ')}`);
  }
  return resolved;
}

export const isEmbedded = (key) => Object.hasOwn(TEMPLATES, key);

async function fetchFromGitHub(key, { insecure } = {}) {
  let response;
  try {
    response = await request({
      url: `https://api.github.com/licenses/${key}`,
      method: 'GET',
      headers: { 'User-Agent': 'aiflow', Accept: 'application/vnd.github+json' },
      timeoutMs: 30000,
      insecure,
    });
  } catch (error) {
    throw new UserError(`Не удалось загрузить текст лицензии ${key} с GitHub: ${error.message}. Выберите mit, bsd-3-clause, bsd-2-clause, isc или unlicense (они работают офлайн).`);
  }
  if (response.status >= 400) throw new UserError(`GitHub вернул ${new HttpError(response.status).message} при загрузке лицензии ${key}.`);
  const body = JSON.parse(response.text).body;
  if (!body || !String(body).trim()) throw new UserError('GitHub вернул пустой текст лицензии.');
  return String(body);
}

/** License text is never written by the language model: it comes from a template or from GitHub. */
export async function licenseText(key, { year, holder, insecure, fetcher = fetchFromGitHub }) {
  const body = isEmbedded(key) ? TEMPLATES[key] : await fetcher(key, { insecure });
  return `${body.replaceAll('[year]', String(year)).replaceAll('[fullname]', holder).replace(/\r\n/g, '\n').trimEnd()}\n`;
}
