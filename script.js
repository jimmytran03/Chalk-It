import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";


// Use your own firebase
const appId = 'chalk-it-1b483'; 
const firebaseConfig = {
    apiKey: 
    authDomain: 
    projectId: 
    storageBucket:      
    messagingSenderId: 
    appId: 
    measurementId: 
};

const initialAuthToken = null; 

let app;
let auth;
let db;
let userId = null;
let isAuthReady = false;

async function initializeFirebase() {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                console.log("Firebase Authenticated! User ID:", userId);
            } else {
                console.log("No user found, signing in anonymously...");
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                        console.log("Signed in with custom token.");
                    } else {
                        await signInAnonymously(auth);
                        console.log("Signed in anonymously.");
                    }
                } catch (error) {
                    console.error("Error during anonymous sign-in or custom token sign-in:", error);
                }
            }
            isAuthReady = true; 
            if (userId) {
                listenForJournalEntries();
            }
        });
    } catch (error) {
        console.error("Error initializing Firebase:", error);
        document.getElementById('loadingEntries').textContent = "Error loading application. Please try again.";
    }
}

/**
 * Retries a function with exponential backoff.
 * @param {Function} fn - The function to retry.
 * @param {number} retries - The number of retries remaining.
 * @param {number} delay - The current delay in milliseconds.
 */
async function retryWithBackoff(fn, retries = 5, delay = 1000) {
    try {
        return await fn();
    } catch (error) {
        if (retries > 0) {
            console.warn(`Retrying in ${delay / 1000}s... (${retries} retries left)`, error);
            await new Promise(res => setTimeout(res, delay));
            return retryWithBackoff(fn, retries - 1, delay * 2);
        } else {
            throw error; // Re-throw if no retries left
        }
    }
}

/**
 * Calls the Gemini API to get sentiment analysis and feedback of the text.
 * @param {string} text - The journal entry text.
 * @returns {Promise<{sentiment: string, feedback: string}>} - The analysis result.
 */
async function getAnalysisFromAI(text) {
    const sentimentDisplay = document.getElementById('sentimentDisplay');
    const feedbackDisplay = document.getElementById('feedbackDisplay');
    const feedbackContent = document.getElementById('feedbackContent');

    sentimentDisplay.textContent = 'Analyzing sentiment...';
    sentimentDisplay.classList.remove('hidden');
    feedbackDisplay.classList.add('hidden'); 

    let chatHistory = [];
    const prompt = `Based on the following journal entry, provide a sentiment analysis (e.g., Positive, Neutral, Negative) and then offer a brief, empathetic, and constructive piece of feedback or insight. Focus on encouraging self-reflection or offering a supportive perspective. Format your response clearly with 'Sentiment:' and 'Feedback:' prefixes on separate lines.
    Journal Entry: "${text}"`;
    chatHistory.push({ role: "user", parts: [{ text: prompt }] });

    const payload = {
        contents: chatHistory
    };

    const apiKey = " "; // <<< REPLACE THIS WITH YOUR GEMINI API KEY for local testing!
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    try {
        const response = await retryWithBackoff(async () => {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({})); 
                throw new Error(`API call failed with status: ${res.status}. ${errorData.error?.message || res.statusText}`);
            }
            return res;
        });

        const result = await response.json();
        let sentiment = 'Could not analyze.';
        let feedback = 'No feedback generated.';

        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            const fullText = result.candidates[0].content.parts[0].text;
            const lines = fullText.split('\n');

            for (const line of lines) {
                if (line.startsWith('Sentiment:')) {
                    sentiment = line.substring('Sentiment:'.length).trim();
                } else if (line.startsWith('Feedback:')) {
                    feedback = line.substring('Feedback:'.length).trim();
                }
            }
        } else {
            console.error("Unexpected API response structure:", result);
            sentiment = 'Could not analyze.';
            feedback = 'No feedback generated.';
        }

        sentimentDisplay.textContent = `Sentiment: ${sentiment}`;
        feedbackContent.textContent = feedback;
        feedbackDisplay.classList.remove('hidden');

        return { sentiment, feedback };

    } catch (error) {
        console.error("Error calling Gemini API:", error);
        sentimentDisplay.textContent = 'Sentiment: Error analyzing.';
        feedbackContent.textContent = `Error generating feedback: ${error.message}`; 
        feedbackDisplay.classList.remove('hidden'); 
        return { sentiment: 'Error analyzing', feedback: `Error generating feedback: ${error.message}` };
    }
}

/**
 * Saves a journal entry to Firestore.
 * @param {string} text - The journal entry text.
 * @param {string} sentiment - The sentiment analysis result.
 * @param {string} feedback - The AI feedback.
 */
async function saveJournalEntry(text, sentiment, feedback) {
    if (!userId) {
        console.error("User not authenticated. Cannot save entry.");
        return;
    }

    try {
        const userJournalCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/journalEntries`);
        await addDoc(userJournalCollectionRef, {
            text: text,
            timestamp: new Date(),
            sentiment: sentiment,
            feedback: feedback,
            userId: userId
        });
        console.log("Journal entry saved successfully!");
    } catch (error) {
        console.error("Error saving journal entry:", error);
        document.getElementById('sentimentDisplay').textContent = "Error saving entry. Please try again.";
    }
}


function listenForJournalEntries() {
    if (!userId || !isAuthReady) {
        console.warn("Firebase not ready or user not authenticated to listen for entries.");
        return;
    }

    const entriesContainer = document.getElementById('entriesContainer');
    const loadingEntriesText = document.getElementById('loadingEntries');

    const userJournalCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/journalEntries`);
    const q = userJournalCollectionRef; 

    onSnapshot(q, (snapshot) => {
        loadingEntriesText.classList.add('hidden'); 
        const entries = [];
        snapshot.forEach((doc) => {
            entries.push({ id: doc.id, ...doc.data() });
        });

        entries.sort((a, b) => {
            const dateA = a.timestamp ? a.timestamp.toDate() : new Date(0); 
            const dateB = b.timestamp ? b.timestamp.toDate() : new Date(0); 
            return dateB.getTime() - dateA.getTime();
        });

        entriesContainer.innerHTML = ''; 

        if (entries.length === 0) {
            entriesContainer.innerHTML = '<p class="text-center text-gray-500">No entries yet. Start writing!</p>';
        } else {
            entries.forEach(entry => {
                const entryElement = document.createElement('div');
                entryElement.classList.add('journal-entry', 'flex', 'flex-col', 'space-y-2');

                const date = entry.timestamp ? new Date(entry.timestamp.toDate()).toLocaleString() : 'N/A';
                const sentiment = entry.sentiment || 'Not analyzed';
                const feedback = entry.feedback || 'No feedback provided.';

                entryElement.innerHTML = `
                    <div class="flex justify-between items-center text-sm text-gray-600">
                        <span class="font-medium">${date}</span>
                        <span class="font-semibold text-blue-700">${sentiment}</span>
                    </div>
                    <p class="text-gray-800">${entry.text}</p>
                    ${feedback !== 'No feedback provided.' ? `<div class="feedback-display text-sm">
                        <strong>AI Feedback:</strong> ${feedback}
                    </div>` : ''}
                `;
                entriesContainer.appendChild(entryElement);
            });
        }
    }, (error) => {
        console.error("Error listening to journal entries:", error);
        entriesContainer.innerHTML = '<p class="text-center text-red-500">Error loading entries.</p>';
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initializeFirebase();

    const journalTextarea = document.getElementById('journalText');
    const saveButton = document.getElementById('saveEntryButton');
    const sentimentDisplay = document.getElementById('sentimentDisplay');
    const feedbackDisplay = document.getElementById('feedbackDisplay');

    saveButton.addEventListener('click', async () => {
        const text = journalTextarea.value.trim();
        if (text) {
            saveButton.disabled = true;
            saveButton.innerHTML = '<div class="loading-spinner mx-auto"></div>'; 
            sentimentDisplay.classList.remove('hidden');
            sentimentDisplay.textContent = 'Analyzing sentiment and generating feedback...';
            feedbackDisplay.classList.add('hidden'); 

            const { sentiment, feedback } = await getAnalysisFromAI(text);
            await saveJournalEntry(text, sentiment, feedback);

            journalTextarea.value = ''; 
            saveButton.disabled = false;
            saveButton.textContent = 'Save Entry';
        } else {
            sentimentDisplay.classList.remove('hidden');
            sentimentDisplay.textContent = 'Please write something before saving.';
            feedbackDisplay.classList.add('hidden');
        }
    });
});