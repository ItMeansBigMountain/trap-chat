from flask import Flask , request, jsonify , render_template ,jsonify

app = Flask(__name__ , static_url_path='', static_folder='static' , template_folder='templates')


@app.route('/')
def lobby():
  context={}
  return render_template('lobby.html' , context = context )



@app.route('/chat')
def chat_room():
  context={}
  return render_template('index.html' , context = context )





if __name__ == '__main__':
  app.run(host="0.0.0.0" , port=80)
