import { Logger } from '../utils/logger.js';
import { ApplicationError, ErrorCodes } from '../utils/error-boundary.js';
import { GoogleSearchTool } from './google-search.js';
import { WeatherTool } from './weather-tool.js';
import { FirebaseMemoryTool } from './firebase-memory-tool.js'; // Import the new tool

/**
 * Manages the registration and execution of tools.
 * Tools are used to extend the functionality of the Gemini API, allowing it to interact with external services.
 */
export class ToolManager {
    /**
     * Creates a new ToolManager and registers default tools.
     */
    constructor() {
        this.tools = new Map(); // Map: internal_tool_name -> tool_instance
        // Map: function_name_declared_by_tool -> tool_instance
        this.functionMap = new Map();

        this.registerDefaultTools();
        // Build the function map after all default tools are registered
        this.buildFunctionNameMap();
    }

    /**
     * Registers the default tools.
     */
    registerDefaultTools() {
        // Ensure internal tool names are unique
        this.registerTool('googleSearch', new GoogleSearchTool());
        this.registerTool('weather', new WeatherTool());
        this.registerTool('firebaseMemory', new FirebaseMemoryTool()); // Register the new tool
        // Add other default tools here if needed
    }

    /**
     * Registers a new tool.
     *
     * @param {string} name - The internal name of the tool (used by the ToolManager).
     * @param {Object} toolInstance - The tool instance. Must have `getDeclaration` and `execute` methods.
     * @throws {ApplicationError} Throws an error if a tool with the same name is already registered or methods are missing.
     */
    registerTool(name, toolInstance) {
        if (this.tools.has(name)) {
            throw new ApplicationError(
                `Tool ${name} is already registered`,
                ErrorCodes.INVALID_STATE
            );
        }
        // Validate required methods
        if (typeof toolInstance.getDeclaration !== 'function' || typeof toolInstance.execute !== 'function') {
             throw new ApplicationError(
                `Tool "${name}" must have both 'getDeclaration' and 'execute' methods.`,
                 ErrorCodes.INVALID_PARAMETER
             );
        }

        this.tools.set(name, toolInstance);
        Logger.info(`Tool "${name}" registered successfully.`);
    }

    /**
     * Builds a map from function names declared by tools to the tool instance that handles them.
     * This allows efficient lookup of the correct tool when the model calls a specific function.
     */
    buildFunctionNameMap() {
        this.functionMap.clear(); // Clear any existing map

        this.tools.forEach((tool, internalToolName) => {
            try {
                const declaration = tool.getDeclaration();

                if (Array.isArray(declaration)) {
                    // This tool declares one or more specific functions (e.g., WeatherTool, FirebaseMemoryTool)
                    declaration.forEach(funcSpec => {
                        if (!funcSpec || typeof funcSpec.name !== 'string' || !funcSpec.parameters || !funcSpec.description) {
                            Logger.warn(`Tool "${internalToolName}" returned an invalid function declaration structure. Skipping.`, funcSpec);
                            return; // Skip invalid individual declarations
                        }

                        if (this.functionMap.has(funcSpec.name)) {
                            // Handle potential conflicts if multiple tools declare the same function name
                            Logger.warn(`Function name conflict: "${funcSpec.name}" declared by tool "${internalToolName}" is already mapped. Latest mapping wins.`);
                            // Depending on desired behavior, you might throw an error here instead.
                        }
                        this.functionMap.set(funcSpec.name, tool);
                        Logger.debug(`Mapped function "${funcSpec.name}" to tool "${internalToolName}"`);
                    });
                } else if (typeof declaration === 'object' && declaration !== null && Object.keys(declaration).length === 0) {
                    // This tool represents a special tool object (like Google Search returning {})
                    // The model typically calls this using a predefined name (often related to the internal tool name).
                    // We'll map the internal tool name to the tool instance in this case.
                     if (this.functionMap.has(internalToolName)) {
                         Logger.warn(`Internal tool name conflict: "${internalToolName}" is already mapped (likely from a function declaration). The object declaration mapping will not be added.`);
                          // Avoid overwriting a specific function mapping with a generic tool object mapping.
                     } else {
                         // Map the internal tool name to the instance
                         this.functionMap.set(internalToolName, tool);
                         Logger.debug(`Mapped internal tool name "${internalToolName}" to tool "${internalToolName}" (for object declaration).`);
                     }
                } else {
                    Logger.warn(`Tool "${internalToolName}" getDeclaration returned an unexpected type or structure. Expected Array of FunctionDeclarations or an empty Object {}. Skipping mapping.`, declaration);
                }
            } catch (error) {
                 Logger.error(`Error building function map for tool "${internalToolName}":`, error);
            }
        });
         Logger.info('Function name map built.', Array.from(this.functionMap.keys()));
    }


    /**
     * Returns the tool declarations for all registered tools, formatted for the Gemini API.
     *
     * @returns {Object[]} An array of tool declaration objects.
     */
    getToolDeclarations() {
        const allDeclarations = [];

        this.tools.forEach((tool, internalToolName) => {
            try {
                const declaration = tool.getDeclaration();

                if (Array.isArray(declaration)) {
                    // For tools that define specific functions, wrap in functionDeclarations array
                    if (declaration.length > 0) {
                        allDeclarations.push({ functionDeclarations: declaration });
                    } else {
                        Logger.debug(`Tool "${internalToolName}" returned an empty array from getDeclaration(). Skipping.`);
                    }
                } else if (typeof declaration === 'object' && declaration !== null) {
                     // For tools returning a tool object (like Google Search)
                     // The API expects this structure: { tool_name: { ... declaration ... } }
                     // Based on GoogleSearchTool returning {}, this fits the pattern { googleSearch: {} }
                     // We'll push it as { [internalToolName]: declaration }
                     allDeclarations.push({ [internalToolName]: declaration });
                } else {
                    Logger.warn(`Tool "${internalToolName}" getDeclaration returned an invalid type or structure. Skipping inclusion in API declarations.`, declaration);
                }
            } catch (error) {
                 Logger.error(`Error getting declaration for tool "${internalToolName}":`, error);
            }
        });

         Logger.debug('Generated API tool declarations:', JSON.stringify(allDeclarations));
        return allDeclarations;
    }

    /**
     * Handles a function call from the Gemini API.
     * Executes the specified function using the appropriate tool instance.
     *
     * @param {Object} functionCall - The function call object from the Gemini API.
     * @param {string} functionCall.name - The name of the function to execute (as declared by the tool).
     * @param {Object} functionCall.args - The arguments to pass to the tool's execute method.
     * @param {string} functionCall.id - The ID of the function call.
     * @returns {Promise<Object>} A promise that resolves with the tool's response formatted for the API.
     */
    async handleToolCall(functionCall) {
        const { name: functionName, args, id } = functionCall; // Rename 'name' to functionName for clarity
        Logger.info(`Handling function call: "${functionName}" (ID: ${id})`, { args });

        // Find the tool instance responsible for this function name
        const tool = this.functionMap.get(functionName);

        if (!tool) {
            Logger.error(`Received call for unknown function: "${functionName}".`);
            // Return an error response to the API
            return {
                functionResponses: [{
                    response: {
                         error: `Function "${functionName}" is not available.`
                    },
                    id // Include the ID from the original call
                }]
            };
        }

        // Although checked in buildFunctionNameMap, a final check is good practice
         if (typeof tool.execute !== 'function') {
              Logger.error(`Internal error: Tool mapped to function "${functionName}" is missing the 'execute' method.`);
               return {
                    functionResponses: [{
                         response: {
                              error: `Internal tool configuration error for "${functionName}".`
                         },
                         id
                    }]
               };
         }


        try {
            // Execute the tool's logic with the provided arguments
            // The execute method should return the data to be sent back to the model.
            const result = await tool.execute(args);

            // Format the tool's result into the API's expected response structure
            // The API expects the tool's return value directly inside the 'response' field.
            return {
                functionResponses: [{
                    response: result, // Place the tool's result directly here
                    id // Include the ID from the original call
                }]
            };
        } catch (error) {
            Logger.error(`Execution failed for function "${functionName}" (ID: ${id}):`, error);

            // Return an error response to the API
            return {
                functionResponses: [{
                    response: {
                        // Provide an error message to the model
                        error: `Execution failed for "${functionName}": ${error.message || 'Unknown error during tool execution.'}`
                    },
                    id // Include the ID from the original call
                }]
            };
        }
    }
}