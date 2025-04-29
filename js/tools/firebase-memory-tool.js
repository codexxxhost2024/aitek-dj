// js/tools/firebase-memory-tool.js
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore'; // Import Firestore methods
import { Logger } from '../utils/logger.js';
import { ApplicationError, ErrorCodes } from '../utils/error-boundary.js'; // Using ApplicationError for consistency

// Firebase configuration provided by the user
// NOTE: In a real application, this config should ideally be loaded from environment variables
// or a configuration file, not hardcoded directly in the source.
const firebaseConfig = {
  apiKey: "AIzaSyBceuJHkf0twNcMYb5xkQLlZb_iXOoJx3Q",
  authDomain: "explore-jobx-lvs1op.firebaseapp.com",
  databaseURL: "https://explore-jobx-lvs1op-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "explore-jobx-lvs1op",
  storageBucket: "explore-jobx-lvs1op.appspot.com",
  messagingSenderId: "552760837186",
  appId: "1:552760837186:web:8f5371acb0c21e6b31d9db"
};

let dbInstance; // Variable to hold the Firestore instance

/**
 * Initializes Firebase and gets the Firestore instance if it hasn't been already.
 */
function initializeFirebase() {
    if (!getApps().length) {
        try {
            const app = initializeApp(firebaseConfig);
            dbInstance = getFirestore(app);
            Logger.info('Firebase app initialized and Firestore instance obtained.');
        } catch (error) {
            Logger.error('Failed to initialize Firebase:', error);
            // Depending on the app structure, you might want to handle this error
            // more robustly, perhaps preventing tool instantiation or marking it unavailable.
            // For now, we just log and leave dbInstance undefined, which will cause errors later.
        }
    } else {
        // If apps already exist, just get the default one and its Firestore instance
        try {
             const app = getApp();
             dbInstance = getFirestore(app);
             Logger.info('Using existing Firebase app and Firestore instance.');
        } catch (error) {
             Logger.error('Failed to get existing Firebase app or Firestore instance:', error);
        }
    }
}

// Initialize Firebase when the module loads
initializeFirebase();


/**
 * Represents a tool for saving information to Firebase Firestore.
 * This tool provides a function to save a piece of text as a 'memory'.
 */
export class FirebaseMemoryTool {

    constructor() {
        if (!dbInstance) {
            // If Firebase initialization failed, throw an error
            throw new ApplicationError(
                'Firebase Firestore is not initialized. Cannot create FirebaseMemoryTool.',
                ErrorCodes.DEPENDENCY_ERROR
            );
        }
        this.db = dbInstance; // Store the initialized Firestore instance
        this.collectionName = "memory"; // Use the specified collection name
    }

    /**
     * Returns the tool declaration for the Gemini API.
     * Defines a function to save a piece of memory.
     *
     * @returns {Object[]} An array containing the function declaration for saving memory.
     */
    getDeclaration() {
        return [{
            name: "save_memory",
            description: "Saves a piece of important information or memory provided by the user to long-term storage.",
            parameters: {
                type: "object",
                properties: {
                    memory_content: {
                        type: "string",
                        description: "The specific information or memory content to be saved. Should be concise and accurate."
                    }
                },
                required: ["memory_content"]
            }
        }
        // Add more function declarations here if the tool had other capabilities, e.g., get_memory
        /*
        , {
             name: "get_memory",
             description: "Retrieves a previously saved memory.",
             parameters: {
                 type: "object",
                 properties: {
                     // Define parameters for retrieval, e.g., search terms, keywords, date
                     keywords: {
                         type: "string",
                         description: "Keywords to search for in saved memories."
                     }
                 },
                 required: ["keywords"] // Or other required parameters
             }
        }
        */
        ];
    }

    /**
     * Executes the firebase memory tool.
     * Currently, this only supports the 'save_memory' function.
     *
     * @param {Object} args - The arguments for the tool function call.
     * @param {string} args.memory_content - The content of the memory to save.
     * @returns {Promise<Object>} A promise that resolves with the result of the execution.
     * @throws {Error} Throws an error if the execution fails or arguments are missing.
     */
    async execute(args) {
        try {
            Logger.info('Executing FirebaseMemoryTool', args);

            // Validate arguments
            const { memory_content } = args;
            if (!memory_content || typeof memory_content !== 'string') {
                 throw new ApplicationError(
                    'Missing or invalid "memory_content" argument for save_memory function.',
                     ErrorCodes.INVALID_PARAMETER
                 );
            }

            // Get a reference to the collection
            const memoryCollection = collection(this.db, this.collectionName);

            // Add a new document to the collection
            const docRef = await addDoc(memoryCollection, {
                content: memory_content,
                timestamp: serverTimestamp() // Use server timestamp
            });

            Logger.info(`Memory saved successfully with ID: ${docRef.id}`);

            // Return a success response that the model can understand
            return {
                status: "success",
                message: `Memory saved with ID ${docRef.id}.`,
                docId: docRef.id
            };

        } catch (error) {
            Logger.error('FirebaseMemoryTool execution failed', error);
             // Return an error response for the model
             return {
                 status: "error",
                 message: `Failed to save memory: ${error.message}`
             };
            // Decide whether to re-throw or just return the error object based on ToolManager's handling
            // The ToolManager's handleToolCall currently returns an error object in the response, so returning here is consistent.
        }
    }
}