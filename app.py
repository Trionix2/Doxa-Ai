from flask import Flask, render_template, request, Response, session, redirect, url_for, jsonify
from datetime import datetime
import io
import base64
from google import genai
from google.genai import types
from supabase import create_client, Client
import os

app = Flask(__name__)
app.secret_key = os.urandom(24)

# Initialize Supabase Client
SUPABASE_URL = "https://hsswbfymhvertfhdgueg.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzc3diZnltaHZlcnRmaGRndWVnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjIwODg4OSwiZXhwIjoyMDk3Nzg0ODg5fQ.61Y4kuYAk_LWa4d5_LYSZl8Wx4C_NnP3iMOyZjMg7vE"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Initialize the Gemini client with your API key
client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

# Dictionary mapping frontend personality modes to instructions with professional emojis
PERSONALITY_PROMPTS = {
    "standard": "Use nice, clean, and professional emojis naturally in your responses.",
    "less words, direct and straight to the point": "You are a concise AI assistant. Use absolute minimum words, direct answers, no fluff, and include neat, clean, and professional emojis ⚡.",
    "warm, engaging, and supportive": "You are a warm, highly enthusiastic, friendly, and supportive AI companion. Use friendly, clean, and professional emojis 🎉.",
    "professional, technical, and objective": "You are a rigorous, serious, professional, and objective technical expert. Use sparse, clean, and professional emojis appropriately 💼.",
    "strict code snippets and minimal chatter": "You are a coding-only assistant. Provide clean code blocks with almost zero conversational text and neat, clean emojis 💻."
}

@app.route('/')
def index():
    if 'user_id' not in session:
        return redirect(url_for('login_page'))
    return render_template('index.html', username=session.get('username'))

@app.route('/login', methods=['GET', 'POST'])
def login_page():
    if request.method == 'POST':
        data = request.get_json() if request.is_json else request.form
        username = data.get('username', '').strip()
        email = data.get('email', '').strip()
        mode = data.get('mode', 'signin')
        
        if not email:
            return jsonify({"success": False, "error": "Email is required"}), 400
        
        response = supabase.table('users').select('*').eq('email', email).execute()
        
        if mode == 'signup':
            if response.data and len(response.data) > 0:
                return jsonify({"success": False, "error": "An account with this email already exists. Please Sign In."}), 400
            
            new_user = supabase.table('users').insert({
                "username": username or email.split('@')[0],
                "email": email,
                "password": "otp_verified_user"
            }).execute()
            user = new_user.data[0]
        else:
            if not response.data or len(response.data) == 0:
                return jsonify({"success": False, "error": "No account found with this email. Please Sign Up first."}), 400
            user = response.data[0]
            if username and username != user['username']:
                supabase.table('users').update({"username": username}).eq('id', user['id']).execute()
                user['username'] = username
            
        session['user_id'] = int(user['id'])
        session['username'] = user['username']
        
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
    if not user_id:
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    
    response = supabase.table('chats').select('chat_id, title').eq('user_id', int(user_id)).execute()
    return jsonify({"success": True, "chats": response.data})

@app.route('/api/chat/<chat_id>', methods=['GET'])
def get_single_chat(chat_id):
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({"success": False, "error": "Unauthorized"}), 401
        
    response = supabase.table('chats').select('*').eq('chat_id', chat_id).eq('user_id', int(user_id)).execute()
    if not response.data:
        return jsonify({"success": False, "error": "Chat not found"}), 404
        
    return jsonify({"success": True, "chat": response.data[0]})

@app.route('/api/chat/save', methods=['POST'])
def save_chat():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({"success": False, "error": "Unauthorized"}), 401
        
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
        result = client.models.generate_images(
            model="imagen-3.0-generate-002",
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                output_mime_type="image/jpeg"
            )
        )
        
        generated_img = result.generated_images[0].image
        buffered = io.BytesIO()
        generated_img.save(buffered, format="JPEG")
        img_base64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
        image_data_url = f"data:image/jpeg;base64,{img_base64}"
        
        return jsonify({
            "success": True,
            "image_url": image_data_url,
            "response_text": f"Here is the image you requested: '{prompt}' 🎨"
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Image generation service unavailable: {str(e)}"
        }), 500

@app.route('/chat', methods=['POST'])
def chat():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json()
    history = data.get('history', [])
    selected_mode = data.get('mode', 'standard')
    current_user_name = session.get('username', 'User')

    personality_instruction = PERSONALITY_PROMPTS.get(selected_mode, PERSONALITY_PROMPTS["standard"])

    def generate():
        try:
            current_date_str = datetime.now().strftime("%B %d, %Y")
            
            config = types.GenerateContentConfig(
                system_instruction=(
                    f"You are Doxa AI—an intelligent, warm, energetic, and engaging personal AI collaborator and software engineering assistant. "
                    f"Today's date is {current_date_str}. "
                    f"You are talking directly to your user whose name is {current_user_name}. Always refer to them by their name ({current_user_name}) naturally in conversation. "
                    "Never identify yourself as a product of Google or Gemini. Always present yourself strictly as Doxa AI. "
                    "Be warm, conversational, hyped, relatable, and deeply supportive. Match a casual, energetic vibe while remaining sharp, practical, and highly skilled in full-stack development, Python, JavaScript, and tech. "
                    "Balance empathy with candor. Act like a true close collaborator who celebrates wins, hypes up code projects, and jumps straight into problem-solving. "
                    f"Personality Vibe Modifier: {personality_instruction}"
                ),
            )

            response = client.models.generate_content(
                model="gemini-3.1-flash-lite",
                contents=history,
                config=config
            )

            if hasattr(response, 'text') and response.text:
                yield response.text
            elif hasattr(response, 'candidates'):
                for candidate in response.candidates:
                    if candidate.content and candidate.content.parts:
                        for part in candidate.content.parts:
                            if hasattr(part, 'text') and part.text:
                                yield part.text
            else:
                yield str(response)

        except Exception as e:
            yield f"\n[Error: {str(e)}]"

    return Response(generate(), mimetype='text/plain')

if __name__ == '__main__':
    app.run(debug=True, port=5000)