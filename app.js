// app.js
(() => {
  const TSV_PATH = 'reviews_test.tsv';
  
  // Альтернативные модели для sentiment analysis
  const MODELS = {
    primary: 'https://api-inference.huggingface.co/models/cardiffnlp/twitter-roberta-base-sentiment-latest',
    fallback: 'https://api-inference.huggingface.co/models/distilbert-base-uncased-finetuned-sst-2-english'
  };

  const statusEl = document.getElementById('status');
  const randomBtn = document.getElementById('randomBtn');
  const reloadBtn = document.getElementById('reloadBtn');
  const hfTokenInput = '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';
  const reviewArea = document.getElementById('reviewArea');
  const reviewTextEl = document.getElementById('reviewText');
  const sentIcon = document.getElementById('sentIcon');
  const labelText = document.getElementById('labelText');
  const scoreText = document.getElementById('scoreText');
  const errorEl = document.getElementById('error');

  let reviews = []; // array of strings
  let currentModelUrl = MODELS.primary;

  function setStatus(msg, muted = true) {
    statusEl.textContent = msg;
    statusEl.style.color = muted ? '#6c757d' : '#007bff';
  }

  function showError(msg) {
    errorEl.style.display = 'block';
    errorEl.textContent = msg;
  }

  function clearError() {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  function setIcon(type) {
    // type: 'positive' | 'negative' | 'neutral' | 'loading' | 'idle'
    sentIcon.className = 'icon';
    if (type === 'positive') {
      sentIcon.innerHTML = '<i class="fa-solid fa-thumbs-up" style="color:var(--success)"></i>';
    } else if (type === 'negative') {
      sentIcon.innerHTML = '<i class="fa-solid fa-thumbs-down" style="color:var(--danger)"></i>';
    } else if (type === 'neutral') {
      sentIcon.innerHTML = '<i class="fa-solid fa-question" style="color:var(--neutral)"></i>';
    } else if (type === 'loading') {
      sentIcon.innerHTML = '<i class="fa-solid fa-spinner fa-pulse" style="color:var(--muted)"></i>';
    } else {
      sentIcon.innerHTML = '<i class="fa-solid fa-comment" style="color:var(--muted)"></i>';
    }
  }

  async function fetchAndParseTSV() {
    setStatus('Fetching reviews_test.tsv...');
    clearError();
    reviewArea.style.display = 'none';
    try {
      const res = await fetch(TSV_PATH);
      if (!res.ok) {
        throw new Error(`Failed to fetch ${TSV_PATH}: ${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      setStatus('Parsing TSV with Papa Parse...');
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      if (parsed.errors && parsed.errors.length) {
        console.warn('PapaParse errors:', parsed.errors);
      }
      const data = parsed.data || [];
      const lowerKeys = data.length ? Object.keys(data[0]).map(k => k.toLowerCase()) : [];
      let textKey = null;
      if (lowerKeys.includes('text')) {
        textKey = Object.keys(data[0]).find(k => k.toLowerCase() === 'text');
      }

      if (!textKey) {
        throw new Error('TSV does not contain a "text" column (case-insensitive).');
      }

      reviews = data.map(row => (row[textKey] != null ? String(row[textKey]) : '')).filter(t => t.trim().length > 0);

      if (!reviews.length) {
        throw new Error('No non-empty reviews found in "text" column.');
      }

      setStatus(`Loaded ${reviews.length} reviews. Ready.`);
      reviewArea.style.display = 'block';
      setIcon('idle');
      labelText.textContent = 'Label: —';
      scoreText.textContent = 'Score: —';
      reviewTextEl.textContent = 'Click "Analyze Random Review" to start.';
    } catch (err) {
      setStatus('Error loading TSV.');
      showError(err.message || String(err));
      console.error(err);
    }
  }

  function pickRandomReview() {
    if (!reviews.length) return null;
    const idx = Math.floor(Math.random() * reviews.length);
    return reviews[idx];
  }

  // Локальный fallback анализ на основе ключевых слов
  function localSentimentAnalysis(text) {
    const positiveWords = ['love', 'excellent', 'great', 'best', 'outstanding', 'good', 'amazing', 
                          'perfect', 'awesome', 'fantastic', 'recommend', 'fast', 'wonderful'];
    const negativeWords = ['terrible', 'disappointed', 'broke', 'bad', 'worst', 'horrible', 
                          'awful', 'broken', 'poor', 'problem', 'waste', 'useless'];
    
    const words = text.toLowerCase().split(/\s+/);
    let positiveCount = 0;
    let negativeCount = 0;
    
    words.forEach(word => {
      const cleanWord = word.replace(/[^a-z]/g, '');
      if (positiveWords.includes(cleanWord)) positiveCount++;
      if (negativeWords.includes(cleanWord)) negativeCount++;
    });
    
    if (positiveCount > negativeCount) {
      return { label: 'POSITIVE', score: Math.min(0.95, 0.6 + (positiveCount * 0.1)) };
    } else if (negativeCount > positiveCount) {
      return { label: 'NEGATIVE', score: Math.min(0.95, 0.6 + (negativeCount * 0.1)) };
    } else if (positiveCount === 0 && negativeCount === 0) {
      return { label: 'NEUTRAL', score: 0.5 };
    } else {
      return { label: 'NEUTRAL', score: 0.5 };
    }
  }

  async function tryModelWithFallback(review, modelUrl, token, isRetry = false) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const body = JSON.stringify({ inputs: review });

    try {
      const resp = await fetch(modelUrl, { method: 'POST', headers, body });
      
      // Модель загружается
      if (resp.status === 503) {
        const json = await resp.json().catch(() => ({}));
        if (json.estimated_time) {
          throw new Error(`Model loading (wait ~${Math.ceil(json.estimated_time)}s)`);
        }
        throw new Error('Model loading, please wait and try again');
      }

      // Проблемы с авторизацией - используем локальный анализ
      if (resp.status === 401 || resp.status === 403) {
        if (!isRetry) {
          console.log('Auth failed, trying fallback model...');
          return await tryModelWithFallback(review, MODELS.fallback, token, true);
        }
        console.log('All models require auth, using local analysis');
        const localResult = localSentimentAnalysis(review);
        return { 
          data: localResult, 
          source: 'local',
          message: 'Using local analysis (API requires authentication)'
        };
      }

      // Rate limit
      if (resp.status === 429) {
        if (!isRetry) {
          console.log('Rate limit hit, trying fallback model...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          return await tryModelWithFallback(review, MODELS.fallback, token, true);
        }
        throw new Error('Rate limit exceeded. Please wait or provide API token.');
      }

      if (!resp.ok) {
        let errText = `${resp.status} ${resp.statusText}`;
        try {
          const j = await resp.json();
          if (j && j.error) errText += ` — ${j.error}`;
        } catch (e) {}
        throw new Error(`API error: ${errText}`);
      }

      const json = await resp.json();
      const parsed = parseHuggingFaceResponse(json);
      
      if (!parsed) {
        throw new Error('Unexpected API response format');
      }

      return { data: parsed, source: 'api' };

    } catch (err) {
      if (!isRetry && !err.message.includes('Model loading')) {
        console.log('Primary model failed, trying fallback...');
        try {
          return await tryModelWithFallback(review, MODELS.fallback, token, true);
        } catch (fallbackErr) {
          console.log('All API attempts failed, using local analysis');
          const localResult = localSentimentAnalysis(review);
          return { 
            data: localResult, 
            source: 'local',
            message: `API unavailable: ${err.message}`
          };
        }
      }
      throw err;
    }
  }

  function parseHuggingFaceResponse(json) {
    let entry = null;

    // Обработка разных форматов ответа от HF
    if (Array.isArray(json)) {
      if (Array.isArray(json[0])) {
        // [[{label, score}]]
        entry = json[0][0];
      } else if (json[0] && typeof json[0] === 'object' && 'label' in json[0]) {
        // [{label, score}]
        entry = json[0];
      } else {
        // Поиск первого объекта с label и score
        outer: for (const a of json) {
          if (Array.isArray(a)) {
            for (const b of a) {
              if (b && typeof b === 'object' && 'label' in b && 'score' in b) {
                entry = b;
                break outer;
              }
            }
          } else if (a && typeof a === 'object' && 'label' in a && 'score' in a) {
            entry = a;
            break;
          }
        }
      }
    } else if (json && typeof json === 'object') {
      if ('error' in json) {
        throw new Error(`API returned error: ${json.error}`);
      }
      if ('label' in json && 'score' in json) {
        entry = json;
      }
    }

    if (!entry || typeof entry !== 'object' || !('label' in entry) || !('score' in entry)) {
      console.error('Unexpected response:', json);
      return null;
    }

    // Нормализация label (разные модели используют разные названия)
    let label = String(entry.label).toUpperCase();
    
    // Преобразование label в стандартный формат
    if (label.includes('POS') || label === 'LABEL_1' || label === 'LABEL_2') {
      label = 'POSITIVE';
    } else if (label.includes('NEG') || label === 'LABEL_0') {
      label = 'NEGATIVE';
    } else if (label.includes('NEU') || label === 'NEUTRAL') {
      label = 'NEUTRAL';
    }

    const score = Number(entry.score);

    return { label, score };
  }

  async function analyzeReview(review) {
    clearError();
    labelText.textContent = 'Label: —';
    scoreText.textContent = 'Score: —';
    setIcon('loading');
    setStatus('Analyzing sentiment...');
    
    const token = hfTokenInput.value.trim();

    try {
      const result = await tryModelWithFallback(review, currentModelUrl, token);
      
      const { label, score } = result.data;

      labelText.textContent = `Label: ${label}`;
      scoreText.textContent = `Score: ${isFinite(score) ? score.toFixed(3) : '—'}`;

      // Определение типа результата
      let resultType = 'neutral';
      if (score > 0.5 && label === 'POSITIVE') {
        resultType = 'positive';
      } else if (score > 0.5 && label === 'NEGATIVE') {
        resultType = 'negative';
      } else {
        resultType = 'neutral';
      }

      setIcon(resultType);
      
      if (result.source === 'local') {
        setStatus(`Analysis complete (local fallback). ${result.message || ''}`);
        if (result.message) {
          showError(`ℹ️ ${result.message}`);
        }
      } else {
        setStatus('Analysis complete (API).');
      }
      
    } catch (err) {
      console.error('Analyze error:', err);
      
      // Последний fallback - локальный анализ
      try {
        const localResult = localSentimentAnalysis(review);
        labelText.textContent = `Label: ${localResult.label}`;
        scoreText.textContent = `Score: ${localResult.score.toFixed(3)}`;
        
        let resultType = 'neutral';
        if (localResult.score > 0.5 && localResult.label === 'POSITIVE') {
          resultType = 'positive';
        } else if (localResult.score > 0.5 && localResult.label === 'NEGATIVE') {
          resultType = 'negative';
        }
        
        setIcon(resultType);
        setStatus('Analysis complete (local fallback).');
        showError(`ℹ️ Using local analysis: ${err.message}`);
      } catch (fallbackErr) {
        setIcon('neutral');
        setStatus('Analysis failed.');
        showError(`Error: ${err.message || String(err)}`);
      }
    }
  }

  async function onRandomClick() {
    clearError();
    if (!reviews.length) {
      showError('No reviews loaded. Reload TSV first.');
      return;
    }
    randomBtn.disabled = true;
    reloadBtn.disabled = true;
    setStatus('Selecting random review...');
    const review = pickRandomReview();
    if (!review) {
      showError('Failed to pick a review.');
      randomBtn.disabled = false;
      reloadBtn.disabled = false;
      return;
    }
    reviewTextEl.textContent = review;
    labelText.textContent = 'Label: —';
    scoreText.textContent = 'Score: —';
    reviewArea.style.display = 'block';
    await analyzeReview(review);
    randomBtn.disabled = false;
    reloadBtn.disabled = false;
  }

  randomBtn.addEventListener('click', onRandomClick);
  reloadBtn.addEventListener('click', () => {
    fetchAndParseTSV();
  });

  // Initial load
  fetchAndParseTSV();
})();
