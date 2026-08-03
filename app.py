from flask import Flask, render_template, request, Response, session, redirect, url_for, jsonify
from flask_cors import CORS
from datetime import datetime
import urllib.parse
import re
from google import genai
from google.genai import types
from supabase import create_client, Client
from openai import OpenAI
import os

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", os.urandom(24))

# Enable CORS for all domains/routes so your frontend connects instantly
CORS(app, resources={r"/*": {"origins": "*"}})

# Initialize Supabase Client using environment variables
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Initialize the Gemini client using environment variables
client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

# Initialize OpenAI client using environment variables
openai_client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

PERSONALITY_PROMPTS = {
    "standard": "Use nice, clean, and professional emojis naturally in your responses.",
    "less words, direct and straight to the point": "You are a concise AI assistant. Use absolute minimum words, direct answers, no fluff, and include neat, clean, and professional emojis ⚡.",
    "warm, engaging, and supportive": "You are a warm, highly enthusiastic, friendly, and supportive AI companion. Use friendly, clean, and professional emojis 🎉.",
    "professional, technical, and objective": "You are a rigorous, serious, professional, and objective technical expert. Use sparse, clean, and professional emojis appropriately 💼.",
    "strict code snippets and minimal chatter": "You are a coding-only assistant. Provide clean code blocks with almost zero conversational text and neat, clean emojis 💻."
}

@app.route('/robots.txt')
def robots_txt():
    content = "User-agent: *\nAllow: /"
    return Response(content, mimetype="text/plain")

@app.route('/welcome')
def welcome_page():
    return render_template('welcome.html')

@app.route('/')
def index():
    if 'user_id' not in session:
        return redirect(url_for('login_page'))
    return render_template('index.html', username=session.get('username'))

@app.route('/login', methods=['GET', 'POST'])
def login_page():
    if request.method == 'POST':
        data = request.get_json() if request.is_json else request.form
        mode = data.get('mode', 'signin')
        email = data.get('email', '').strip()
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        
        if mode == 'guest':
            session['user_id'] = 999999
            session['username'] = "Guest User"
            session['is_guest'] = True
            if request.is_json:
                return jsonify({"success": True, "redirect": url_for('index')})
            return redirect(url_for('index'))

        if not email:
            return jsonify({"success": False, "error": "Email is required"}), 400
        
        response = supabase.table('users').select('*').eq('email', email).execute()
        
        if mode == 'signup':
            if response.data and len(response.data) > 0:
                return jsonify({"success": False, "error": "An account with this email already exists. Please Sign In."}), 400
            
            if not password:
                return jsonify({"success": False, "error": "Password is required for registration"}), 400

            new_user = supabase.table('users').insert({
                "username": username or email.split('@')[0],
                "email": email,
                "password": password
            }).execute()
            user = new_user.data[0]
            
        else:
            if not response.data or len(response.data) == 0:
                return jsonify({"success": False, "error": "No account found with this email. Please Sign Up first."}), 400
            
            user = response.data[0]
            stored_password = user.get('password')
            if stored_password and stored_password != "otp_verified_user" and stored_password != password:
                return jsonify({"success": False, "error": "Incorrect password. Please try again."}), 400
            
            if stored_password == "otp_verified_user" and password:
                supabase.table('users').update({"password": password}).eq('id', user['id']).execute()

        session['user_id'] = int(user['id'])
        session['username'] = user['username']
        session['is_guest'] = False
        
        if request.is_json:
            return jsonify({"success": True, "redirect": url_for('index')})
        return redirect(url_for('index'))
        
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login_page'))

@app.route('/api/history', methods=['GET'])
def get_chat_history():
    user_id = session.get('user_id')
    if not user_id or session.get('is_guest'):
        return jsonify({"success": True, "chats": []})
    
    response = supabase.table('chats').select('chat_id, title').eq('user_id', int(user_id)).execute()
    return jsonify({"success": True, "chats": response.data})

@app.route('/api/chat/<chat_id>', methods=['GET'])
def get_single_chat(chat_id):
    user_id = session.get('user_id')
    if not user_id or session.get('is_guest'):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
        
    response = supabase.table('chats').select('*').eq('chat_id', chat_id).eq('user_id', int(user_id)).execute()
    if not response.data:
        return jsonify({"success": False, "error": "Chat not found"}), 404
        
    return jsonify({"success": True, "chat": response.data[0]})

@app.route('/api/chat/save', methods=['POST'])
def save_chat():
    user_id = session.get('user_id')
    if not user_id or session.get('is_guest'):
        return jsonify({"success": True, "message": "Guest mode: chat not saved"})
        
    data = request.get_json()
    chat_id = data.get('chat_id')
    title = data.get('title', 'New Chat')
    messages = data.get('messages', [])
    
    if not chat_id:
        return jsonify({"success": False, "error": "Chat ID required"}), 400

    supabase.table('chats').upsert({
        "chat_id": chat_id,
        "user_id": int(user_id),
        "title": title,
        "messages": messages
    }, on_conflict='chat_id').execute()
    
    return jsonify({"success": True})

@app.route('/generate-image', methods=['POST'])
def generate_image():
    if 'user_id' not in session:
        return jsonify({"success": False, "error": "Unauthorized"}), 401

    data = request.get_json()
    prompt = data.get('prompt', '').strip()

    if not prompt:
        return jsonify({"success": False, "error": "Prompt is required"}), 400
        
    try:
        encoded_prompt = urllib.parse.quote(prompt)
        image_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width=1536&height=1536&nologo=true&enhance=true"
        
        shimmer_html = f'<div class="doxa-img-container" style="position: relative; max-width: 350px; margin: 12px auto;"><img src="{image_url}" alt="{prompt}" onload="this.classList.add(\'loaded\');" style="width: 100%; max-width: 350px; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 18px; display: block; background: #120d1a; background-image: linear-gradient(90deg, #120d1a 0%, #3b1b6e 50%, #120d1a 100%); background-size: 250% 100%; background-position: -125% 0; animation: doxa-purple-shimmer 1.2s infinite linear;" /><a href="{image_url}" download="doxa_image.jpg" target="_blank" class="doxa-download-btn">📥 Download</a></div>'
        
        return jsonify({
            "success": True,
            "image_url": image_url,
            "response_text": shimmer_html
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Image generation service unavailable: {str(e)}"
        }), 500

@app.route('/chat', methods=['POST'])
@app.route('/api/chat', methods=['POST'])
def chat():
    user_id = session.get('user_id')
    current_user_name = "User"
    
    # Fetch the exact username dynamically from Supabase using their session user_id
    if user_id and not session.get('is_guest'):
        try:
            user_res = supabase.table('users').select('username').eq('id', int(user_id)).execute()
            if user_res.data and len(user_res.data) > 0:
                current_user_name = user_res.data[0].get('username', 'User')
        except Exception:
            current_user_name = session.get('username', 'User')
    else:
        current_user_name = session.get('username', 'Guest User')

    data = request.get_json() or {}
    
    history = data.get('history', [])
    message = data.get('message', '').strip()
    
    if message and not history:
        history = [{"role": "user", "parts": [{"text": message}]}]
        
    selected_mode = data.get('mode', 'standard')
    personality_instruction = PERSONALITY_PROMPTS.get(selected_mode, PERSONALITY_PROMPTS["standard"])
    
    # Capture request headers *before* entering the generator to prevent context errors
    wants_json = request.headers.get('Accept') == 'application/json' or not request.headers.get('X-Streaming')

    def generate():
        try:
            current_date_str = datetime.now().strftime("%B %d, %Y")
            
            config = types.GenerateContentConfig(
                system_instruction=(
                    f"You are Doxa AI—an intelligent, warm, energetic, and engaging personal AI collaborator and software engineering assistant. "
                    f"Today's date is {current_date_str}. "
                    f"You are talking directly to your user whose name is {current_user_name}. Always refer to them by their name ({current_user_name}) naturally. "
                    f"Never identify yourself as a product of Google or Gemini. Always present yourself strictly as Doxa AI. "
                    f"CRITICAL TIMELINE RULE: Never claim that future movies, trailers, or scheduled events have already been released in the past unless they strictly occurred before {current_date_str}. Always verify release calendars accurately against the current date. "
                    f"TEMPORAL OVERRIDE RULE: Today is strictly {current_date_str}. If a scheduled event, movie premiere, or release matches this exact date in your context, treat it as actively happening right now. Never default to dismissing it as a rumor or fan-made trick unless specified. "
                    f"HUMAN & AI IDENTITY: Behave as naturally, conversationally, and human-like as possible in your tone, empathy, and conversational flow, but never forget or deny that you are an advanced AI assistant. "
                    f"IMAGE GENERATION RULE: NEVER generate images automatically or on your own. Only generate an image if {current_user_name} explicitly asks or tells you to draw, generate, or create an image. When explicitly told to generate an image, output EXACTLY this format on its own line: `[GENERATE_IMAGE: detailed prompt description]`, followed by your response. "
                    f"Personality Vibe Modifier: {personality_instruction}"
                ),
            )

            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=history,
                config=config
            )

            raw_text = ""
            if hasattr(response, 'text') and response.text:
                raw_text = response.text
            elif hasattr(response, 'candidates'):
                for candidate in response.candidates:
                    if candidate.content and candidate.content.parts:
                        for part in candidate.content.parts:
                            if hasattr(part, 'text') and part.text:
                                raw_text += part.text
            else:
                raw_text = str(response)

            def replace_image_tag(match):
                img_prompt = match.group(1).strip()
                encoded_prompt = urllib.parse.quote(img_prompt)
                img_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width=1536&height=1536&nologo=true&enhance=true"
                return f'<div class="doxa-img-container" style="position: relative; max-width: 350px; margin: 12px auto;"><img src="{img_url}" alt="{img_prompt}" onload="this.classList.add(\'loaded\');" style="width: 100%; max-width: 350px; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 18px; display: block; background: #120d1a; background-image: linear-gradient(90deg, #120d1a 0%, #3b1b6e 50%, #120d1a 100%); background-size: 250% 100%; background-position: -125% 0; animation: doxa-purple-shimmer 1.2s infinite linear;" /><a href="{img_url}" download="doxa_image.jpg" target="_blank" class="doxa-download-btn">📥 Download</a></div>'

            processed_text = re.sub(r'\[GENERATE_IMAGE:\s*(.*?)\]', replace_image_tag, raw_text)
            
            if wants_json:
                return jsonify({"response": processed_text})
                
            yield processed_text

        except Exception as e:
            error_msg = f"\n[Error: {str(e)}]"
            if wants_json:
                return jsonify({"response": error_msg}), 500
            yield error_msg

    if wants_json:
        return generate()

    return Response(generate(), mimetype='text/plain')

@app.route('/api/openai-chat', methods=['POST'])
def openai_chat():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401
        
    user_id = session.get('user_id')
    current_user_name = "User"
    
    # Fetch the exact username dynamically for OpenAI as well
    if user_id and not session.get('is_guest'):
        try:
            user_res = supabase.table('users').select('username').eq('id', int(user_id)).execute()
            if user_res.data and len(user_res.data) > 0:
                current_user_name = user_res.data[0].get('username', 'User')
        except Exception:
            current_user_name = session.get('username', 'User')
    else:
        current_user_name = session.get('username', 'Guest User')

    data = request.get_json()
    history = data.get('history', [])
    current_date_str = datetime.now().strftime("%B %d, %Y")

    formatted_messages = [
        {
            "role": "system",
            "content": f"You are Doxa AI, a high-level software engineering collaborator talking to {current_user_name}. Today's date is {current_date_str}. Provide clean, structured, and comprehensive code."
        }
    ]

    for msg in history:
        role = msg.get('role')
        parts = msg.get('parts', [])
        text_content = "".join([p.get('text', '') for p in parts if isinstance(p, dict) and 'text' in p])
        if role and text_content:
            openai_role = "assistant" if role == "model" else "user"
            formatted_messages.append({"role": openai_role, "content": text_content})

    def generate_openai():
        try:
            stream = openai_client.chat.completions.create(
                model="gpt-4o",
                messages=formatted_messages,
                stream=True
            )
            for chunk in stream:
                content = chunk.choices[0].delta.content
                if content:
                    yield content
        except Exception as e:
            yield f"\n[OpenAI Error: {str(e)}]"

    return Response(generate_openai(), mimetype='text/plain')

if __name__ == '__main__':
    app.run(debug=True, port=5000)
