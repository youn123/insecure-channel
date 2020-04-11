/**
 * Contains general-purpose useful functions 
 */

export function breakText(text, threshold) {
    let words = text.split(' ');
    let chars = text.split('');

    let numNewlines = 0;

    for (let i = 0, realIndex = words[i].length, lineLength = words[i].length;
            i < words.length - 1; i++) {
        if (lineLength + words[i+1].length + 1 > threshold) {
            chars[realIndex] = '\n';
            numNewlines++;
            lineLength = words[i+1].length;
            realIndex += (words[i+1].length + 1); 
        } else {
            lineLength += (words[i+1].length + 1);
            realIndex += (words[i+1].length + 1); 
        }
    }

    return {text: chars.join(''), numNewlines: numNewlines};
}

export function arrayEquals(a, b) {
    if (a.length != b.length) {
        return false;
    }

    a.sort((x, y) => x.localeCompare(y));
    b.sort((x, y) => x.localeCompare(y));

    for (let i = 0; i < a.length; i++) {
        if (a[i] != b[i]) {
            return false;
        }
    }

    return true;
}