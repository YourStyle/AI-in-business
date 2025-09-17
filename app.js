const reviewTextElement = document.getElementById('review-text');
const sentimentIconElement = document.getElementById('sentiment-icon');
const sentimentLabelElement = document.getElementById('sentiment-label');
const scoreDetailsElement = document.getElementById('score-details');
const analyzeButton = document.getElementById('analyze-button');
const tokenInput = document.getElementById('token-input');
const statusMessageElement = document.getElementById('status-message');
const reviewCountElement = document.getElementById('review-count');

let reviewTexts = [];
let isAnalyzing = false;

function setStatus(message) {
    statusMessageElement.textContent = message;
}

function setReviewCount(count) {
    if (typeof count === 'number' && count > 0) {
        reviewCountElement.textContent = `${count.toLocaleString()} review${count === 1 ? '' : 's'} available.`;
    } else {
        reviewCountElement.textContent = '';
    }
}

function updateSentimentDisplay({ iconClasses, toneClass, labelText, details }) {
    const classList = ['sentiment-icon'];
    if (toneClass) {
        classList.push(toneClass);
    }
    const icons = Array.isArray(iconClasses) ? iconClasses : ['fa-solid', 'fa-circle-question'];
    classList.push(...icons);
    sentimentIconElement.className = classList.join(' ');
    sentimentLabelElement.textContent = labelText;

    scoreDetailsElement.replaceChildren();
    (details || []).forEach(detail => {
        const line = document.createElement('span');
        line.textContent = detail;
        scoreDetailsElement.appendChild(line);
    });
}

function prettifyLabel(label) {
    const normalized = String(label || '').toLowerCase();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function interpretSentimentResponse(data) {
    let predictions = data;
    if (Array.isArray(predictions) && predictions.length === 1 && Array.isArray(predictions[0])) {
        predictions = predictions[0];
    }

    if (!Array.isArray(predictions)) {
        throw new Error('Unexpected response format from Hugging Face.');
    }

    const cleanedPredictions = predictions
        .map(item => ({
            label: typeof item.label === 'string' ? item.label.trim().toUpperCase() : '',
            score: typeof item.score === 'number' ? item.score : NaN,
        }))
        .filter(item => item.label && Number.isFinite(item.score));

    if (!cleanedPredictions.length) {
        throw new Error('No sentiment predictions were returned.');
    }

    let positiveScore = null;
    let negativeScore = null;
    cleanedPredictions.forEach(item => {
        if (item.label.includes('POSITIVE')) {
            positiveScore = positiveScore === null ? item.score : Math.max(positiveScore, item.score);
        }
        if (item.label.includes('NEGATIVE')) {
            negativeScore = negativeScore === null ? item.score : Math.max(negativeScore, item.score);
        }
    });

    const detailLines = cleanedPredictions.map(item => `${prettifyLabel(item.label)}: ${(item.score * 100).toFixed(1)}%`);

    if (positiveScore !== null && positiveScore > 0.5) {
        return {
            iconClasses: ['fa-solid', 'fa-thumbs-up'],
            toneClass: 'positive',
            labelText: 'Positive sentiment detected',
            details: detailLines,
        };
    }

    if (negativeScore !== null && negativeScore > 0.5) {
        return {
            iconClasses: ['fa-solid', 'fa-thumbs-down'],
            toneClass: 'negative',
            labelText: 'Negative sentiment detected',
            details: detailLines,
        };
    }

    return {
        iconClasses: ['fa-solid', 'fa-circle-question'],
        toneClass: 'neutral',
        labelText: 'Neutral or uncertain sentiment',
        details: detailLines,
    };
}

async function queryHuggingFace(reviewText) {
    const token = tokenInput.value.trim();
    const headers = {
        'Content-Type': 'application/json',
    };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch('https://api-inference.huggingface.co/models/siebert/sentiment-roberta-large-english', {
        method: 'POST',
        headers,
        body: JSON.stringify({ inputs: reviewText }),
    });

    const payload = await response.json().catch(() => {
        throw new Error('Failed to parse the Hugging Face response.');
    });

    if (!response.ok) {
        const errorMessage = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
        throw new Error(`Hugging Face API error: ${errorMessage}`);
    }

    if (payload.error) {
        throw new Error(`Hugging Face API error: ${payload.error}`);
    }

    return payload;
}

function pickRandomReview() {
    if (!reviewTexts.length) {
        throw new Error('No reviews available to analyze.');
    }
    const index = Math.floor(Math.random() * reviewTexts.length);
    return reviewTexts[index];
}

async function handleAnalyzeClick() {
    if (isAnalyzing) {
        return;
    }
    if (!reviewTexts.length) {
        setStatus('Reviews are still loading or unavailable.');
        return;
    }

    isAnalyzing = true;
    analyzeButton.disabled = true;

    const review = pickRandomReview();
    reviewTextElement.textContent = review;
    updateSentimentDisplay({
        iconClasses: ['fa-solid', 'fa-circle-notch', 'fa-spin'],
        toneClass: 'neutral',
        labelText: 'Analyzing sentiment...',
        details: [],
    });
    setStatus('Analyzing review with Hugging Face Inference API...');

    try {
        const response = await queryHuggingFace(review);
        const sentimentData = interpretSentimentResponse(response);
        updateSentimentDisplay(sentimentData);
        setStatus('Analysis complete.');
    } catch (error) {
        console.error(error);
        updateSentimentDisplay({
            iconClasses: ['fa-solid', 'fa-triangle-exclamation'],
            toneClass: 'negative',
            labelText: 'Unable to determine sentiment',
            details: [],
        });
        setStatus(error.message || 'An unknown error occurred while analyzing sentiment.');
    } finally {
        isAnalyzing = false;
        analyzeButton.disabled = !reviewTexts.length;
    }
}

async function loadReviews() {
    try {
        setStatus('Loading reviews from TSV file...');
        reviewTextElement.textContent = 'Loading reviews...';
        const response = await fetch('reviews_test.tsv', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Failed to fetch reviews (HTTP ${response.status}).`);
        }
        const tsvContent = await response.text();
        const parsed = Papa.parse(tsvContent, {
            header: true,
            delimiter: '\t',
            skipEmptyLines: true,
        });

        if (parsed.errors && parsed.errors.length) {
            const firstError = parsed.errors[0];
            throw new Error(`Parsing error on row ${firstError.row ?? 'unknown'}: ${firstError.message}`);
        }

        const texts = parsed.data
            .map(row => (typeof row.text === 'string' ? row.text.trim() : ''))
            .filter(text => text.length > 0);

        if (!texts.length) {
            throw new Error('No valid review texts found in the TSV file.');
        }

        reviewTexts = texts;
        setReviewCount(reviewTexts.length);
        analyzeButton.disabled = false;
        reviewTextElement.textContent = 'Click "Analyze Random Review" to explore a sentiment insight!';
        setStatus('Reviews loaded successfully.');
    } catch (error) {
        console.error(error);
        reviewTexts = [];
        analyzeButton.disabled = true;
        setReviewCount(0);
        reviewTextElement.textContent = 'Unable to load reviews.';
        updateSentimentDisplay({
            iconClasses: ['fa-solid', 'fa-circle-question'],
            toneClass: 'neutral',
            labelText: 'Sentiment analysis pending',
            details: [],
        });
        setStatus(error.message || 'An unknown error occurred while loading reviews.');
    }
}

analyzeButton.addEventListener('click', handleAnalyzeClick);
loadReviews();
