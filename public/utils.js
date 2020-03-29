function breakText(text, threshold) {
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