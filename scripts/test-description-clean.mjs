const MAX_DESCRIPTION_CHARS = 2600;

function clean(s) {
  let d = (s || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  const wasTruncated = /\.{2,}\s*$/.test(d);
  d = d.replace(/\s+/g, ' ').replace(/\.{2,}\s*$/g, '').trim();
  if (wasTruncated) {
    const lastCompleteSentence = d.lastIndexOf('.');
    d = lastCompleteSentence >= 0 ? d.slice(0, lastCompleteSentence + 1).trim() : '';
  }
  if (d.length > MAX_DESCRIPTION_CHARS) {
    const complete = d.slice(0, MAX_DESCRIPTION_CHARS + 1).match(/^.*[.!?](?=\s|$)/);
    d = complete?.[0]?.trim() || d.slice(0, MAX_DESCRIPTION_CHARS).trim();
  }
  if (d && !/[.!?]$/.test(d)) d += '.';
  return d;
}

const input = 'A nova geração da linha Realme chega para transformar sua experiência de navegação e produtividade com uma combinação impressionante de armazenamento e velocidade de processamento. O Realme 14 5G foi projetado para quem não abre mão de performance, oferecendo impressionantes 512GB de memória interna e 12GB de memória RAM, garantindo fluidez total mesmo com diversas janelas e aplicativos pesados abertos simultaneamente. Este dispositivo se destaca pela conectividade 5G de alta velocidade e pela tecnologia NFC integrada, que facilita pagamentos por aproximação e transferências de dados seguras com apenas um toque. Sua estrutura moderna abriga um conjunto tecnológico equilibrado que prioriza a eficiência energética e uma interface de usuário otimizada para respostas imediatas. O aparelho mantém o compromisso da marca com telas de alta qualidade e sistemas de carregamento que acompanham o...';
const output = clean(input);
if (output.endsWith('...') || !/[.!?]$/.test(output) || output.length > MAX_DESCRIPTION_CHARS || output.includes('acompanham o') || output.endsWith('o.')) {
  throw new Error(`Saída inválida: ${output}`);
}
console.log(JSON.stringify({ length: output.length, output }));
